import type { IBuildable, IModuleDependency, IPublishedModule } from '../builds';
import { Addresses } from './addresses';
import { Externals } from './externals';

export /*bundle*/ interface IPreviewModule {
	specifier: string;

	/**
	 * `environment`: selected for development and served by this service, or an installed package this
	 * environment compiles for browsers. `cdn`: every other module, at its exact version. `unresolved`: a
	 * module that no address could be given to, with the reason.
	 */
	source: 'environment' | 'cdn' | 'unresolved';
	version?: string;

	/**
	 * The versioned identity of a module served by this environment, which builds and the runtime name it by
	 */
	vspecifier?: string;
	url?: string;
	reason?: string;

	/**
	 * The address of the stylesheet of the module, when its sources produce one and it is served by this
	 * environment. The document links the stylesheets of the modules that are not widgets; a widget adopts
	 * its own sheets inside its shadow root.
	 */
	styles?: string;

	/**
	 * Whether the module declares a widget
	 */
	widget?: boolean;

	/**
	 * Who holds the stylesheet of a module that has one: the document, when the entry reaches the module
	 * without crossing a widget, or the widgets that import it, which adopt it in their own roots
	 */
	scope?: 'document' | 'widget';
}

/**
 * A module in development as the development runtime needs to know it to apply its updates
 */
export /*bundle*/ interface IPreviewUpdatable {
	package: string;
	vspecifier: string;
	path: string;
}

export /*bundle*/ interface IPreviewDiagnostic {
	code: string;
	message: string;
}

const WEB = { platform: 'web', environment: 'development' };

/**
 * The public modules that a preview of one entry module loads, each with the place it comes from.
 *
 * The graph is the one of compiled public modules, read from what the host reports for each artifact: this
 * object compiles and classifies nothing. A workspace module comes from the environment when it is selected
 * for development and from the CDN, at the version the workspace declares, when it is not. What the
 * workspace does not contain comes from the CDN at its resolved version. The dependencies of a module that
 * the CDN delivers are those of its source in the workspace; the dependencies of a package that is not in
 * the workspace are unknown to this service.
 */
export class Graph {
	#delivery: IBuildable;
	#selected: (module: IPublishedModule) => boolean;
	#addresses: Addresses;
	#externals: Externals;

	#modules = new Map<string, IPreviewModule>();
	get modules(): IPreviewModule[] {
		return [...this.#modules.values()].sort((a, b) => a.specifier.localeCompare(b.specifier));
	}

	#diagnostics: IPreviewDiagnostic[] = [];
	get diagnostics() {
		return this.#diagnostics;
	}

	#runtimes = new Set<string>();

	#updatable: Record<string, IPreviewUpdatable> = {};

	/**
	 * The modules of the graph that this environment serves in development, by specifier: the only ones a
	 * build can update, and all that the runtime of a page needs to know of the session to apply updates
	 */
	get updatable(): Record<string, IPreviewUpdatable> {
		return { ...this.#updatable };
	}

	/**
	 * The runtime modules that the artifacts of the graph are assembled against
	 */
	get runtimes(): string[] {
		return [...this.#runtimes];
	}

	/**
	 * @param selected Whether a public module of the workspace is in development
	 */
	constructor(delivery: IBuildable, selected: (module: IPublishedModule) => boolean, addresses: Addresses, externals: Externals) {
		this.#delivery = delivery;
		this.#selected = selected;
		this.#addresses = addresses;
		this.#externals = externals;
	}

	static specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	#report(code: string, message: string) {
		!this.#diagnostics.some(one => one.code === code && one.message === message) && this.#diagnostics.push({ code, message });
	}

	#published(module: IPreviewModule, name: string, version: string, subpath: string): IPreviewModule {
		const url = this.#addresses.published(name, version, subpath);
		if (url) return Object.assign(module, { source: 'cdn', version, url });

		const reason = `No CDN origin is configured (${Addresses.VARIABLE} is not set)`;
		this.#report('PREVIEW_CDN_UNSET', `"${module.specifier}" is not in development and ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`);
		return Object.assign(module, { source: 'unresolved', version, reason });
	}

	async #external(specifier: string, importer: IPublishedModule, runtime: boolean): Promise<void> {
		if (this.#modules.has(specifier)) return;
		const module: IPreviewModule = { specifier, source: 'unresolved' };
		this.#modules.set(specifier, module);

		const { name, subpath, version, reason } = await this.#externals.resolve(specifier, importer.path, runtime);

		// An installed package this environment compiles for browsers is loaded from the environment
		if (version && (await this.#delivery.supplies?.(name, version))) {
			const vspecifier = subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
			Object.assign(module, { source: 'environment', version, vspecifier, url: this.#addresses.environment(name, version, subpath) });
			const { delivered } = await this.#delivery.module({ name, version, subpath, vspecifier: `${name}@${version}` }, WEB);
			delivered?.styles && (module.styles = this.#addresses.styles(name, version, subpath));
			const edges = delivered?.dependencies?.filter(dependency => dependency.source !== 'builtin').map(dependency => dependency.specifier) ?? [];
			this.#edges.set(specifier, edges);
			for (const dependency of delivered?.dependencies ?? []) {
				if (dependency.source === 'builtin') continue;
				const local = this.#known.find(one => Graph.specifier(one) === dependency.specifier);
				local ? this.#queue.push(local) : await this.#external(dependency.specifier, importer, false);
			}
			return;
		}
		if (version) return void this.#published(module, name, version, subpath);

		module.reason = reason;
		this.#report('PREVIEW_VERSION_UNRESOLVED', `"${specifier}", imported by "${Graph.specifier(importer)}": ${reason}`);
	}

	/**
	 * Adds a module of a package that the workspace does not contain, at the version its runtime resolves
	 * to, such as the coordinator of a runtime delivered by the CDN
	 *
	 * @returns The module, with its address when it has one
	 */
	async runtime(specifier: string, importer: IPublishedModule): Promise<IPreviewModule> {
		await this.#external(specifier, importer, true);
		return this.#modules.get(specifier);
	}

	/**
	 * Walks the graph from the given workspace modules
	 */
	#queue: IPublishedModule[] = [];
	#known: IPublishedModule[] = [];

	/**
	 * The public dependencies of each module of the graph, and which modules are widgets, which is what
	 * says whose stylesheet the document holds
	 */
	#edges: Map<string, string[]> = new Map();
	#widgets: Set<string> = new Set();

	/**
	 * Marks the scope of every stylesheet of the graph: a module the given roots reach without crossing a
	 * widget is linked by the document, any other is adopted by the widgets that import it
	 */
	scope(roots: IPublishedModule[]) {
		const reached = new Set<string>();
		const pending = roots.map(root => Graph.specifier(root));
		for (let specifier = pending.shift(); specifier; specifier = pending.shift()) {
			if (reached.has(specifier)) continue;
			reached.add(specifier);
			!this.#widgets.has(specifier) && pending.push(...(this.#edges.get(specifier) ?? []));
		}
		this.#modules.forEach((module, specifier) => module.styles && (module.scope = reached.has(specifier) ? 'document' : 'widget'));
	}

	async walk(roots: IPublishedModule[], published: IPublishedModule[]): Promise<void> {
		const pending = (this.#queue = [...roots]);
		this.#known = published;

		for (let module = pending.shift(); module; module = pending.shift()) {
			const specifier = Graph.specifier(module);
			if (this.#modules.has(specifier)) continue;

			const { name, version, subpath } = module;
			const entry: IPreviewModule = { specifier, source: 'environment', version };
			this.#modules.set(specifier, entry);
			if (this.#selected(module)) {
				entry.vspecifier = module.vspecifier;
				entry.url = this.#addresses.environment(name, version, subpath);
				this.#updatable[specifier] = { package: name, vspecifier: module.vspecifier, path: this.#addresses.path(name, version, subpath) };
			} else this.#published(entry, name, version, subpath);

			const { delivered, failure } = await this.#delivery.module(module, WEB);
			if (!delivered) {
				for (const { code, message } of failure.diagnostics ?? [failure]) this.#report(code, `${specifier}: ${message}`);
				continue;
			}

			// The stylesheet of a module in development is held by the document or by the widgets that import the module
			if (this.#selected(module) && delivered.styles) entry.styles = this.#addresses.styles(name, version, subpath);
			if (delivered.widget) {
				entry.widget = true;
				this.#widgets.add(specifier);
			}

			// The runtime is imported by the artifact itself, not by its sources, so the host names it apart
			const runtime = delivered.runtime;
			runtime && this.#runtimes.add(runtime);
			const dependencies = [...(runtime ? [{ specifier: runtime, source: 'runtime' }] : []), ...(delivered.dependencies ?? [])];
			this.#edges.set(specifier, (<IModuleDependency[]>dependencies).filter(one => one.source !== 'builtin').map(one => one.specifier));

			for (const dependency of <IModuleDependency[]>dependencies) {
				const { source } = dependency;
				if (source === 'builtin') {
					this.#report('PREVIEW_BUILTIN', `"${specifier}" imports the Node builtin "${dependency.specifier}", which a browser does not provide`);
					continue;
				}

				// A runtime that the workspace itself contains is one more public module of the workspace
				const local = published.find(one => (dependency.vspecifier ? one.vspecifier === dependency.vspecifier : Graph.specifier(one) === dependency.specifier));
				local ? pending.push(local) : await this.#external(dependency.specifier, module, source === 'runtime');
			}
		}
	}
}
