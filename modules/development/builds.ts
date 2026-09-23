import type { Log } from './log';
import type { Files } from './files';
import { DevelopmentError } from './error';
import { Located, type ILocatedDiagnostic, type IProducedDiagnostic } from './located';

/**
 * Why the delivery could not produce what a build asked for
 */
export /*bundle*/ interface IBuildFailure {
	code: string;
	message: string;
	diagnostics?: IProducedDiagnostic[];
}

/**
 * What a build needs from the hosting service: the published modules and the delivery of each one.
 * It is the stable facade the host gives its extensions, never a Packages Workspace held directly.
 */
export /*bundle*/ interface IBuildable {
	/**
	 * Reloads what the service hosts when package or module declarations changed since it was last asked
	 */
	refresh?(): Promise<void>;

	/**
	 * Whether the host delivers an installed package at an exact version to browsers
	 */
	supplies?(name: string, version: string): Promise<boolean>;

	/**
	 * The registry id the compiled-module paths of the host write for a package at an exact version, or why it
	 * has none: the workspace and npm are unprefixed, and an installed package is addressed by the registry its
	 * lockfile recorded. A host without it addresses every package unprefixed.
	 */
	origin?(name: string, version: string): Promise<{ registry?: string; reason?: string }>;

	/**
	 * The registry id of the base address of a registry, such as the `publishConfig.registry` of a package
	 */
	registry?(base: string): Promise<string | undefined>;

	published(): Promise<IPublishedModule[]>;
	module(request: object, conditions: object): Promise<{
		delivered?: { hash: string; styles?: string; stylesheets?: string[]; dependencies?: IModuleDependency[]; runtime?: string; widget?: object };
		failure?: IBuildFailure;
	}>;

	/**
	 * The public declaration of a module, when the host produces declarations
	 */
	declaration?(request: object): Promise<{ declaration?: { vspecifier: string; hash: string; code: string }; failure?: IBuildFailure }>;
}

/**
 * A public module of the served workspace. The host also says where its package is, which is where the
 * installed dependencies of the package are found.
 */
export /*bundle*/ interface IPublishedModule {
	vspecifier: string;
	name: string;
	version: string;
	subpath: string;
	specifier?: string;
	path?: string;

	/**
	 * Whether the module belongs to a package the toolchain supplies, which is never the entry of a preview
	 */
	supplied?: boolean;
}

/**
 * How the host classified a public dependency of a compiled module
 */
export /*bundle*/ interface IModuleDependency {
	specifier: string;
	source: 'workspace' | 'runtime' | 'builtin' | 'external';
	vspecifier?: string;
}

export /*bundle*/ interface IBuild {
	id: string;
	state: 'running' | 'completed' | 'failed' | 'superseded' | 'cancelled';
	input: string;
	modules: { vspecifier: string; platform?: string; status: 'valid' | 'invalid'; hash?: string; styles?: string; declaration?: string }[];
	diagnostics?: ILocatedDiagnostic[];
}

/**
 * Builds correlated to their input. A build records the cursor it read its sources at; when a source file
 * changed after that cursor, the build ends `superseded`, so an obsolete completion is never current.
 * Compilation itself is Packages' delivery: this object asks for it and reports the outcome.
 *
 * A module is built for every platform it declares, and each result names its platform, because a Node
 * consumer and a browser preview apply the artifact of their own platform. A platform that a module does not
 * declare is not a failure of the build: it is left out.
 *
 * The declaration of a module is checked with it: a module whose sources do not type-check keeps its valid
 * artifacts, because the compiler that produces them does not check types, and the build reports the type
 * errors with their file and position, so the build is `failed` while its modules stay applicable.
 */
export /*bundle*/ class Builds {
	static RETAINED = 50;
	static DEBOUNCE = 150;
	static PLATFORMS = ['node', 'web'];

	#delivery: IBuildable;
	#log: Log;
	#located: Located;
	#conditions: { platform: string }[];
	#items = new Map<string, IBuild>();
	#cancelled = new Set<string>();
	#counter = 0;
	#timer: ReturnType<typeof setTimeout>;
	#unsubscribe: () => void;

	/**
	 * A gate the next delivery waits for. Validation uses it to keep a build running while sources change.
	 */
	hold: Promise<unknown> = Promise.resolve();

	/**
	 * @param conditions The only conditions to build for, when the host serves one kind of consumer.
	 * Without them every module is built for each platform it declares.
	 */
	constructor(delivery: IBuildable, files: Files, conditions?: { platform: string }) {
		this.#delivery = delivery;
		this.#log = files.log;
		this.#located = new Located(files.root, path => files.revision(path));
		this.#conditions = conditions ? [conditions] : Builds.PLATFORMS.map(platform => ({ platform, environment: 'development' }));
	}

	/**
	 * Build after source changes. A batch is built once, at its end, never in its middle.
	 */
	watch() {
		const batches = new Set<unknown>();
		this.#unsubscribe = this.#log.subscribe(event => {
			if (event.type === 'batch.completed') batches.delete(event.batch);
			else if (!event.type.startsWith('file.')) return;
			else if (event.batch) return void batches.add(event.batch);

			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => void this.start(), Builds.DEBOUNCE);
		});
	}

	stop() {
		clearTimeout(this.#timer);
		this.#unsubscribe?.();
	}

	get(id: string): IBuild {
		const build = this.#items.get(id);
		if (!build) throw new DevelopmentError('BUILD_NOT_FOUND', `Build "${id}" not found`, 404);
		return build;
	}

	/**
	 * @returns The running build. Its end is announced as `build.ended`.
	 */
	start(): IBuild {
		const build: IBuild = { id: `bld_${++this.#counter}_${Date.now().toString(36)}`, state: 'running', input: this.#log.cursor, modules: [] };
		this.#items.set(build.id, build);
		if (this.#items.size > Builds.RETAINED) this.#items.delete(this.#items.keys().next().value);

		this.#log.append('build.started', { build: { ...build } });
		void this.#run(build);
		return build;
	}

	cancel(id: string): IBuild {
		const build = this.get(id);
		build.state === 'running' && this.#cancelled.add(id);
		return build;
	}

	/**
	 * Builds one module for each platform it declares. The same source error is reported once, whatever
	 * number of platforms met it.
	 */
	async #module(module: IPublishedModule, build: IBuild, diagnostics: IBuild['diagnostics']) {
		const { vspecifier } = module;
		const report = (failure: IBuildFailure) => {
			for (const diagnostic of failure.diagnostics ?? [failure]) {
				const located = this.#located.of({ ...diagnostic, message: `${vspecifier}: ${diagnostic.message}` });
				!diagnostics.some(one => one.code === located.code && one.message === located.message) && diagnostics.push(located);
			}
		};

		const entries = build.modules.length;
		const undeclared = [];
		for (const conditions of this.#conditions) {
			const { platform } = conditions;
			const { delivered, failure } = await this.#delivery.module(module, conditions);

			const absent = !delivered && failure.diagnostics?.length && failure.diagnostics.every(({ code }) => code === 'CONDITIONAL_NOT_FOUND');
			if (absent) {
				undeclared.push(failure);
				continue;
			}
			// A style module built its stylesheet and has no code: it is valid, and its sheet is what changes
			const sheet = !delivered && failure.code === 'OUTPUT_NOT_AVAILABLE' ? failure.styles : void 0;
			build.modules.push(
				delivered
					? { vspecifier, platform, status: 'valid', hash: delivered.hash, ...(delivered.styles ? { styles: delivered.styles } : {}) }
					: sheet
						? { vspecifier, platform, status: 'valid', styles: sheet }
						: { vspecifier, platform, status: 'invalid' }
			);
			failure && !sheet && report(failure);
		}

		// A module that declares none of the platforms this service builds for has nothing to deliver
		if (undeclared.length === this.#conditions.length) {
			build.modules.push({ vspecifier, status: 'invalid' });
			undeclared.forEach(report);
			return;
		}

		// The declaration, checked once for the module and named by each of its platform entries
		if (!this.#delivery.declaration) return;
		const { declaration, failure } = await this.#delivery.declaration(module);
		if (declaration) build.modules.slice(entries).forEach(entry => entry.status === 'valid' && (entry.declaration = declaration.hash));
		else failure.code === 'BUILD_FAILED' && report(failure);
	}

	async #run(build: IBuild) {
		const diagnostics: IBuild['diagnostics'] = [];
		try {
			await this.hold;
			// Declarations are not watched by the compiler: a package or module declared since the last build
			// exists from this refresh on
			await this.#delivery.refresh?.();
			for (const module of await this.#delivery.published()) {
				if (this.#cancelled.has(build.id)) break;
				await this.#module(module, build, diagnostics);
			}
		} catch (error) {
			diagnostics.push({ code: 'BUILD_ERROR', message: (error as Error).message, severity: 'error' });
		}

		if (diagnostics.length) build.diagnostics = diagnostics;
		// Order matters: a cancelled or obsolete build is reported as such even when it also failed
		build.state = this.#cancelled.delete(build.id) ? 'cancelled'
			: this.#log.changed(build.input) ? 'superseded'
			: diagnostics.length ? 'failed' : 'completed';
		this.#log.append('build.ended', { build: { ...build, modules: [...build.modules] } });
	}
}
