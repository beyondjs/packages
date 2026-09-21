// One statement per specifier: the compiler of this implementation classifies a dependency by the first
// statement that names it, so a separate type-only import would hide the value import from the bundle
import { Selection, type Workspace } from '@beyond-js/packages/workspace';
import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import { Conditions } from './conditions';
import { Compilation } from './compilation';
import { Dependencies } from './dependencies';
import { Resources } from './resources';
import { Installed } from './installed';
import type { IArtifactDependency } from './types';

/**
 * Which module of which exact package version is requested
 */
export /*bundle*/ interface IDeliveryRequest {
	name: string;
	version: string;
	subpath: string;
}

/**
 * Why a module cannot be delivered. The codes are those of the compiled-module contract.
 */
export /*bundle*/ interface IDeliveryFailure {
	code: 'PACKAGE_NOT_FOUND' | 'VERSION_MISMATCH' | 'MODULE_NOT_FOUND' | 'BUILD_FAILED';
	message: string;
	diagnostics?: IDiagnostic[];
}

export /*bundle*/ interface IDelivered {
	vspecifier: string;
	hash: string;

	/**
	 * The conditional that satisfied the request: `web`, or `web/production` for a module that declares a
	 * production build. A request for production is answered only by a production conditional.
	 */
	key: string;

	/**
	 * How each public dependency of the output is satisfied, which is what lets a caller follow the graph
	 * of workspace modules behind an entry point
	 */
	dependencies: IArtifactDependency[];

	/**
	 * The runtime public module that a composed artifact imports, which is not one of the dependencies of
	 * its sources. A packaged artifact imports none.
	 */
	runtime?: string;

	/**
	 * The hash of the stylesheet of the module, when its sources produce one. It changes with the
	 * stylesheet alone, so a consumer replaces the stylesheet of a module whose code did not change.
	 */
	styles?: string;

	/**
	 * The registration of the widget the module declares, when it is one
	 */
	widget?: { name: string; vspecifier: string; attrs?: string[]; render: { csr: boolean; ssr: boolean; sr: boolean } };
	code: (sourcemap: 'inline' | 'none') => string;

	/**
	 * The update of an already loaded module, which carries its source map inline. A packaged module has
	 * none: there is nothing to patch in place, so the value is undefined.
	 */
	patch: () => string | undefined;
}

/**
 * One public module of the workspace, as a development session describes it
 */
export /*bundle*/ interface IPublished {
	specifier: string;
	vspecifier: string;
	name: string;
	version: string;
	subpath: string;

	/**
	 * The directory of the package, where the installed dependencies of its modules are resolved from
	 */
	path: string;

	/**
	 * Whether the package is one the toolchain supplies to every workspace, rather than one of the workspace
	 */
	supplied?: boolean;
}

/**
 * Delivers the current artifact of a public module, compiled on request.
 *
 * It is what a service puts behind the compiled-module API: the answer is always the current state of the
 * sources. A module that does not build, or whose dependencies cannot be satisfied, is a failure with its
 * diagnostics; the output of an earlier successful build is never delivered in its place. Nothing is
 * written to disk, and this object starts no server and keeps no HTTP state.
 */
export /*bundle*/ class Delivery {
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

	constructor(workspace: Workspace) {
		this.#workspace = workspace;
		this.#selection = new Selection(workspace);
		this.#dependencies = new Dependencies(workspace);
		this.#installed = new Installed(() => [...[...workspace.packages.values()].map(pkg => pkg.path), process.cwd()]);
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
				published.push({ specifier: name + path, vspecifier: pkg.vname + path, name, version, subpath, path: pkg.path, ...supplied });
			}
		}
		return published;
	}

	/**
	 * A compiled installed module, as a delivered one: a packaged ES module with no update
	 */
	static #delivered(module: import('./installed').IInstalledModule): IDelivered {
		const { name, version, subpath, hash, code, styles } = module;
		const vspecifier = subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
		return {
			vspecifier,
			hash,
			key: 'installed',
			dependencies: module.dependencies.map(specifier => ({ specifier, source: 'external' })),
			styles: styles?.hash,
			code,
			patch: () => void 0
		};
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
			if (code === 'PACKAGE_NOT_FOUND' && conditions.platform !== 'node') {
				const installed = await this.#installed.module({ name, version, subpath }, conditions);
				if (installed.module) return { delivered: Delivery.#delivered(installed.module) };
				const failure = installed.failure;
				const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND', 'BUILD_FAILED'].includes(failure.code);
				return { failure: { code: known ? <IDeliveryFailure['code']>failure.code : 'BUILD_FAILED', message: failure.message, diagnostics: (<{ diagnostics?: IDiagnostic[] }>failure).diagnostics } };
			}

			const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND'].includes(code);
			return { failure: { code: known ? <IDeliveryFailure['code']>code : 'BUILD_FAILED', message, diagnostics: errors } };
		}

		const compilation = new Compilation(selected.package, subpath, new Conditions(conditions), this.#dependencies);
		await compilation.run();
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
				widget: conditional.artifact.widget,
				code: sourcemap => conditional.output.code(sourcemap === 'inline' ? 'sourcemap-inline' : 'raw-code'),
				patch: () => conditional.patch?.code('sourcemap-inline')
			}
		};
	}
}
