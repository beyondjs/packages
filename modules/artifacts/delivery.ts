// One statement per specifier: the compiler of this implementation classifies a dependency by the first
// statement that names it, so a separate type-only import would hide the value import from the bundle
import { Selection, type Workspace } from '@beyond-js/packages/workspace';
import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import type { Execution } from '@beyond-js/packages/execution';
import { Conditions } from '@beyond-js/packages/module';
import { Compilation } from './compilation';
import { Dependencies } from './dependencies';
import { Resources } from './resources';
import { Installed, type IInstalledModule } from './installed';
import type { IDeliveryRequest, IDeliveryFailure, IDeclaration, IDelivered, IPublished } from './delivered';

/**
 * Delivers the current artifact of a public module, compiled on request.
 *
 * It is what a service puts behind the compiled-module API: the answer is always the current state of the
 * sources. A module that does not build, or whose dependencies cannot be satisfied, is a failure with its
 * diagnostics; the output of an earlier successful build is never delivered in its place. Nothing is
 * written to disk, and this object starts no server and keeps no HTTP state.
 */
export /*bundle*/ class Delivery {
	/**
	 * The key of the conditional that holds the declaration of a module, which no consumer of code selects
	 */
	static TYPES = 'types';

	#workspace: Workspace;
	#selection: Selection;
	#dependencies: Dependencies;

	/**
	 * How selectors of commands and clients resolve in the workspace this object delivers
	 */
	get selection() {
		return this.#selection;
	}

	#resources: Resources;

	/**
	 * The companion resources of the modules: stylesheets and declared static files
	 */
	get resources() {
		return this.#resources;
	}

	#installed: Installed;

	/**
	 * The installed packages this environment compiles for browsers: what the workspace imports and does
	 * not contain, resolved from its packages, the ones the toolchain supplies and the toolchain itself
	 */
	get installed() {
		return this.#installed;
	}

	/**
	 * The execution projection of the installed graph of the workspace, when it has one
	 */
	get execution(): Execution | undefined {
		return this.#workspace.execution;
	}

	constructor(workspace: Workspace) {
		this.#workspace = workspace;
		this.#selection = new Selection(workspace);
		this.#dependencies = new Dependencies(workspace);
		// With an execution the installed graph locates every installed package, and these directories are not read
		this.#installed = new Installed(() => [...[...workspace.packages.values()].map(pkg => pkg.path), process.cwd()], workspace.execution);
		this.#resources = new Resources(workspace, this.#selection, this.#dependencies, this.#installed);
	}


	/**
	 * Whether an installed package at an exact version can be delivered to a browser by this environment
	 */
	async supplies(name: string, version: string): Promise<boolean> {
		await this.#workspace.ready;
		await Promise.all([...this.#workspace.packages.values()].map(pkg => pkg.ready));
		return !!this.#installed.locate(name, version);
	}

	/**
	 * The diagnostics that concern the workspace as a whole, which do not prevent serving its valid modules
	 */
	async diagnostics(): Promise<IDiagnostic[]> {
		await this.#workspace.ready;
		return this.#workspace.errors.concat(await this.#selection.duplicates());
	}

	/**
	 * Every public module the workspace declares, whether or not it currently builds
	 */
	async published(): Promise<IPublished[]> {
		await this.#workspace.ready;
		const published: IPublished[] = [];

		for (const pkg of this.#workspace.packages.values()) {
			await pkg.ready;
			if (!pkg.valid || !pkg.name) continue;

			await pkg.modules.ready;
			for (const subpath of pkg.modules.keys()) {
				const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
				const { name, version } = pkg;
				const supplied = this.#workspace.supplies?.(pkg) ? { supplied: true } : {};
				// The node is found by the canonical path of the package, as every location of the graph is
				const key = this.#workspace.imports.instance(pkg.path);
				const node = key ? { node: key } : {};
				published.push({ specifier: name + path, vspecifier: pkg.vname + path, name, version, subpath, path: pkg.path, ...supplied, ...node });
			}
		}
		return published;
	}

	/**
	 * A compiled installed module, as a delivered one: a packaged ES module with no update
	 */
	static #delivered(module: IInstalledModule): IDelivered {
		const { name, version, subpath, hash, code, styles } = module;
		const vspecifier = subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
		return {
			vspecifier,
			hash,
			key: 'installed',
			dependencies: module.dependencies.map(specifier => ({ specifier, source: 'external' })),
			styles: styles?.hash,
			...(module.stylesheets.length ? { stylesheets: module.stylesheets } : {}),
			code,
			patch: () => void 0
		};
	}

	/**
	 * The public declaration of a workspace module: the output of its `types` conditional, which the `ts`
	 * bundler builds from the sources of the module and the declarations of the workspace modules they
	 * import. A package the workspace does not contain has no declaration here: an installed package
	 * carries its own, and this service does not read them for a consumer.
	 */
	async declaration(request: IDeliveryRequest): Promise<{ declaration?: IDeclaration; failure?: IDeliveryFailure }> {
		const { name, version, subpath } = request;
		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
		const { selected, errors } = await this.#selection.resolve(`${name}@${version}${path}`);
		if (!selected) {
			const [{ code, message }] = errors;
			const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND'].includes(code);
			return { failure: { code: known ? <IDeliveryFailure['code']>code : 'BUILD_FAILED', message, diagnostics: errors } };
		}

		const compilation = new Compilation(selected.package, subpath, new Conditions({ platform: Delivery.TYPES }), this.#dependencies);
		await compilation.run();
		if (!compilation.valid) {
			const [first] = compilation.errors;
			if (first.code === 'CONDITIONAL_NOT_FOUND') {
				const message = `Module "${selected.specifier}" produces no declaration: its bundler has no "types" conditional`;
				return { failure: { code: 'OUTPUT_NOT_AVAILABLE', message } };
			}
			const message = `Module "${selected.specifier}" does not check: ${first.message}`;
			return { failure: { code: 'BUILD_FAILED', message, diagnostics: compilation.errors } };
		}

		const { conditional } = compilation;
		return { declaration: { vspecifier: selected.vspecifier, hash: conditional.output.hash, code: conditional.output.code() } };
	}

	/**
	 * Compiles the requested module for the requested conditions
	 */
	async module(request: IDeliveryRequest, conditions: IConditions): Promise<{ delivered?: IDelivered; failure?: IDeliveryFailure }> {
		const { name, version, subpath } = request;
		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;

		const { selected, errors } = await this.#selection.resolve(`${name}@${version}${path}`);
		if (!selected) {
			const [{ code, message }] = errors;

			// A package the workspace does not contain is delivered from its installation, for browsers
			if (this.#installed.serves(code, request, conditions)) {
				const installed = await this.#installed.module({ name, version, subpath }, conditions);
				if (installed.module) return { delivered: Delivery.#delivered(installed.module) };
				const failure = installed.failure;
				const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND', 'BUILD_FAILED'].includes(failure.code);
				// A code of its own (a missing source, one version claimed twice) stays readable in the diagnostics
				const diagnostics = (<{ diagnostics?: IDiagnostic[] }>failure).diagnostics ?? (known ? void 0 : [failure]);
				return { failure: { code: known ? <IDeliveryFailure['code']>failure.code : 'BUILD_FAILED', message: failure.message, diagnostics } };
			}

			const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND'].includes(code);
			return { failure: { code: known ? <IDeliveryFailure['code']>code : 'BUILD_FAILED', message, diagnostics: errors } };
		}

		const compilation = new Compilation(selected.package, subpath, new Conditions(conditions), this.#dependencies);
		await compilation.run();
		// A style module builds its stylesheet and no code: the module exists, and this output of it does not
		if (!compilation.valid && compilation.styles) {
			return { failure: { code: 'OUTPUT_NOT_AVAILABLE', message: compilation.errors[0].message, diagnostics: compilation.errors, styles: compilation.styles.hash } };
		}
		if (!compilation.valid) {
			const message = `Module "${selected.specifier}" does not build: ${compilation.errors[0].message}`;
			return { failure: { code: 'BUILD_FAILED', message, diagnostics: compilation.errors } };
		}

		const { conditional } = compilation;
		return {
			delivered: {
				vspecifier: selected.vspecifier,
				hash: conditional.output.hash,
				key: compilation.key,
				dependencies: compilation.dependencies,
				runtime: conditional.artifact.runtime,
				styles: conditional.styles?.hash,
				...(conditional.artifact.stylesheets ? { stylesheets: conditional.artifact.stylesheets } : {}),
				widget: conditional.artifact.widget,
				code: sourcemap => conditional.output.code(sourcemap === 'inline' ? 'sourcemap-inline' : 'raw-code'),
				patch: () => conditional.patch?.code('sourcemap-inline')
			}
		};
	}
}
