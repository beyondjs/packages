import type { IBuildable, IModuleDependency, IPublishedModule } from '../builds';
import { Addresses } from './addresses';
import { Externals } from './externals';
import { Imports } from './imports';
import { Stylesheets } from './stylesheets';

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
	 * The stylesheets the sources of the module select by specifier (`pkg/sub.css`): the stylesheet of the
	 * public module `pkg/sub`, with its address and the versioned identity the runtime replaces it by. The
	 * document links those of the modules in its scope; a widget adopts them.
	 */
	stylesheets?: { specifier: string; vspecifier: string; url: string }[];

	/**
	 * Who holds the stylesheets of a module that has them: the document, when the entry reaches the module
	 * without crossing a widget, or the widgets that import it, which adopt them in their own roots
	 */
	scope?: 'document' | 'widget';
}

/**
 * Who imports a module: the public module of the workspace the walk came from, the directory its installed
 * packages resolve from, and the package prefix of its address, which is its scope in the import map
 */
interface IImporter {
	module: IPublishedModule;
	path?: string;
	prefix?: string;
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
 *
 * Every address names the source of its package, as the host reports it (`origin`): npm and the workspace
 * unprefixed, another registry by its id, and a package of the workspace published to another registry by the
 * `publishConfig.registry` of its manifest. A package installed from Git or from an archive address has no
 * address in the compiled-module contract a development service serves, and is reported. An installed package
 * is resolved from the package that imports it, so two importers can reach two versions of one specifier: the
 * first is the import, and the other is given in the scope of its importer.
 */
export class Graph {
	#delivery: IBuildable;
	#selected: (module: IPublishedModule) => boolean;
	#addresses: Addresses;
	#externals: Externals;

	/**
	 * By specifier for the modules of the workspace, by source and version for the installed ones
	 */
	#modules = new Map<string, IPreviewModule>();
	get modules(): IPreviewModule[] {
		return [...this.#modules.values()].sort((a, b) => a.specifier.localeCompare(b.specifier) || (a.version ?? '').localeCompare(b.version ?? ''));
	}

	#imports = new Imports();
	#stylesheets: Stylesheets;

	/**
	 * The import map of the graph: its imports, and the scopes of the importers that resolve another version
	 */
	get importmap() {
		return this.#imports.map;
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

		const known = () => this.#known;
		const registry = (module: IPublishedModule) => this.#registry(module);
		const report = (code: string, message: string) => this.#report(code, message);
		this.#stylesheets = new Stylesheets({ delivery, selected, addresses, externals, imports: this.#imports, known, registry, report });
	}

	static specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	#report(code: string, message: string) {
		!this.#diagnostics.some(one => one.code === code && one.message === message) && this.#diagnostics.push({ code, message });
	}

	#published(module: IPreviewModule, name: string, version: string, subpath: string, registry?: string): IPreviewModule {
		const url = this.#addresses.published(name, version, subpath, registry);
		if (url) return Object.assign(module, { source: 'cdn', version, url });

		const reason = `No CDN origin is configured (${Addresses.VARIABLE} is not set)`;
		this.#report('PREVIEW_CDN_UNSET', `"${module.specifier}" is not in development and ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`);
		return Object.assign(module, { source: 'unresolved', version, reason });
	}

	/**
	 * The registry a package of the workspace is published to, which is where the CDN delivers it from
	 */
	async #registry(module: IPublishedModule): Promise<string | undefined> {
		const base = await this.#externals.publication(module.path);
		return base ? await this.#delivery.registry?.(base) : void 0;
	}

	/**
	 * Gives an importer the address of a specifier: the import, or a scope of the importer
	 */
	#place(specifier: string, module: IPreviewModule, importer?: IImporter): void {
		module.url && this.#imports.add(specifier, module.url, importer?.prefix);
	}

	/**
	 * A module of a package the workspace does not contain, as its importer resolves it
	 */
	async #external(specifier: string, importer: IImporter, runtime: boolean): Promise<IPreviewModule> {
		const { name, subpath, version, reason } = await this.#externals.resolve(specifier, importer.path, runtime);
		const origin = version ? ((await this.#delivery.origin?.(name, version)) ?? { registry: 'npm' }) : void 0;
		const key = origin?.registry ? `${origin.registry}:${name}@${version}/${subpath}` : `${specifier}\n${version ?? ''}`;

		const known = this.#modules.get(key);
		if (known) {
			this.#place(specifier, known, importer);
			return known;
		}
		const module: IPreviewModule = { specifier, source: 'unresolved', ...(version ? { version } : {}) };
		this.#modules.set(key, module);

		const from = Graph.specifier(importer.module);
		if (!version) {
			module.reason = reason;
			this.#report('PREVIEW_VERSION_UNRESOLVED', `"${specifier}", imported by "${from}": ${reason}`);
			return module;
		}
		if (!origin.registry) {
			module.reason = origin.reason;
			this.#report('PREVIEW_SOURCE_UNSUPPORTED', `"${specifier}", imported by "${from}": ${origin.reason}`);
			return module;
		}

		// An installed package this environment compiles for browsers is loaded from the environment
		const { registry } = origin;
		if (!(await this.#delivery.supplies?.(name, version))) {
			this.#published(module, name, version, subpath, registry);
			this.#place(specifier, module, importer);
			return module;
		}

		const vspecifier = subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
		Object.assign(module, { source: 'environment', version, vspecifier, url: this.#addresses.environment(name, version, subpath, registry) });
		this.#place(specifier, module, importer);

		const { delivered } = await this.#delivery.module({ name, version, subpath, vspecifier: `${name}@${version}` }, WEB);
		delivered?.styles && (module.styles = this.#addresses.styles(name, version, subpath, registry));
		module.styles && this.#imports.add(`${specifier}.css`, module.styles, importer.prefix);
		const dependencies = delivered?.dependencies?.filter(dependency => dependency.source !== 'builtin') ?? [];
		this.#edges.set(specifier, dependencies.map(dependency => dependency.specifier));

		// What the installation imports resolves from the installation, and is scoped to its package
		const nested: IImporter = { module: importer.module, path: (await this.#externals.root(name, importer.path)) ?? importer.path, prefix: Addresses.prefix(module.url) };
		await this.#stylesheets.select(module, delivered?.stylesheets, nested);
		for (const dependency of dependencies) {
			const local = this.#known.find(one => Graph.specifier(one) === dependency.specifier);
			local ? this.#queue.push(local) : await this.#external(dependency.specifier, nested, false);
		}
		return module;
	}

	/**
	 * Adds a module of a package that the workspace does not contain, at the version its runtime resolves
	 * to, such as the coordinator of a runtime delivered by the CDN
	 *
	 * @returns The module, with its address when it has one
	 */
	async runtime(specifier: string, importer: IPublishedModule): Promise<IPreviewModule> {
		return this.#external(specifier, { module: importer, path: importer.path }, true);
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
		this.#modules.forEach(module => (module.styles || module.stylesheets) && (module.scope = reached.has(module.specifier) ? 'document' : 'widget'));
	}

	/**
	 * The shared stylesheet of the package of a widget (`./global`, the optional style module every widget of the
	 * package adopts before its own). Nothing imports it, so it is described when a widget of its package is
	 * reached: the runtime then addresses its updates from the session, and finds it as `<package>/global.css`.
	 */
	#global(widget: IPublishedModule, published: IPublishedModule[]): void {
		const global = published.find(one => one.name === widget.name && one.version === widget.version && one.subpath === './global');
		if (!global || !this.#selected(global)) return;
		const specifier = Graph.specifier(global);
		const { name, version, subpath } = global;
		this.#updatable[specifier] ??= { package: name, vspecifier: global.vspecifier, path: this.#addresses.path(name, version, subpath) };
		this.#imports.add(`${specifier}.css`, this.#addresses.styles(name, version, subpath));
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
			} else this.#published(entry, name, version, subpath, await this.#registry(module));
			this.#place(specifier, entry);

			const { delivered, failure } = await this.#delivery.module(module, WEB);
			if (!delivered) {
				for (const { code, message } of failure.diagnostics ?? [failure]) this.#report(code, `${specifier}: ${message}`);
				continue;
			}

			// The stylesheet of a module in development is held by the document or by the widgets that import the
			// module; any module's stylesheet is `<specifier>.css` in the import map, where the runtime finds it
			if (this.#selected(module) && delivered.styles) entry.styles = this.#addresses.styles(name, version, subpath);
			const sheet = entry.styles ?? (delivered.styles && this.#addresses.stylesheet(name, version, subpath, await this.#registry(module)));
			sheet && this.#imports.add(`${specifier}.css`, sheet);
			if (delivered.widget) {
				entry.widget = true;
				this.#widgets.add(specifier);
				this.#global(module, published);
			}

			const importer: IImporter = { module, path: module.path, prefix: entry.url && Addresses.prefix(entry.url) };
			await this.#stylesheets.select(entry, delivered.stylesheets, importer);

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
				local ? pending.push(local) : await this.#external(dependency.specifier, importer, source === 'runtime');
			}
		}
	}
}
