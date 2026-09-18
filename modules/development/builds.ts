import type { Log } from './log';
import { DevelopmentError } from './error';

/**
 * What a build needs from the hosting service: the published modules and the delivery of each one.
 * It is the stable facade the host gives its extensions, never a Packages Workspace held directly.
 */
export /*bundle*/ interface IBuildable {
	/**
	 * Reloads what the service hosts when package or module declarations changed since it was last asked
	 */
	refresh?(): Promise<void>;
	published(): Promise<{ vspecifier: string; name: string; version: string; subpath: string }[]>;
	module(request: object, conditions: object): Promise<{
		delivered?: { hash: string };
		failure?: { code: string; message: string; diagnostics?: { code: string; message: string }[] };
	}>;
}

export /*bundle*/ interface IBuild {
	id: string;
	state: 'running' | 'completed' | 'failed' | 'superseded' | 'cancelled';
	input: string;
	modules: { vspecifier: string; status: 'valid' | 'invalid'; hash?: string }[];
	diagnostics?: { code: string; message: string; severity: 'error' }[];
}

/**
 * Builds correlated to their input. A build records the cursor it read its sources at; when a source file
 * changed after that cursor, the build ends `superseded`, so an obsolete completion is never current.
 * Compilation itself is Packages' delivery: this object asks for it and reports the outcome.
 */
export /*bundle*/ class Builds {
	static RETAINED = 50;
	static DEBOUNCE = 150;

	#delivery: IBuildable;
	#log: Log;
	#conditions: object;
	#items = new Map<string, IBuild>();
	#cancelled = new Set<string>();
	#counter = 0;
	#timer: ReturnType<typeof setTimeout>;
	#unsubscribe: () => void;

	/**
	 * A gate the next delivery waits for. Validation uses it to keep a build running while sources change.
	 */
	hold: Promise<unknown> = Promise.resolve();

	constructor(delivery: IBuildable, log: Log, conditions: object = { platform: 'node', environment: 'development' }) {
		this.#delivery = delivery;
		this.#log = log;
		this.#conditions = conditions;
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

	async #run(build: IBuild) {
		const diagnostics: IBuild['diagnostics'] = [];
		try {
			await this.hold;
			// Declarations are not watched by the compiler: a package or module declared since the last build
			// exists from this refresh on
			await this.#delivery.refresh?.();
			for (const module of await this.#delivery.published()) {
				if (this.#cancelled.has(build.id)) break;
				const { delivered, failure } = await this.#delivery.module(module, this.#conditions);
				const { vspecifier } = module;
				build.modules.push(delivered ? { vspecifier, status: 'valid', hash: delivered.hash } : { vspecifier, status: 'invalid' });
				for (const { code, message } of failure?.diagnostics ?? (failure ? [failure] : [])) {
					diagnostics.push({ code, message: `${vspecifier}: ${message}`, severity: 'error' });
				}
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
