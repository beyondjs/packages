import type { IBuildable, IModuleDependency, IPublishedModule } from '../builds';
import type { Addresses } from './addresses';
import type { Externals } from './externals';
import { Holders } from './holders';
import { Imports } from './imports';
import type { Instances } from './instances';
import type { IImporter, ILocated, ILocator } from './locator';
import { Records } from './records';
import { Routing } from './routing';
import { Stylesheets } from './stylesheets';
import type { IPreviewDiagnostic, IPreviewModule, IPreviewUpdatable } from './types';

const WEB = { platform: 'web', environment: 'development' };

/**
 * A module of the workspace waiting to be walked, with who imported it and by which specifier
 */
interface IPending {
	module: IPublishedModule;
	specifier: string;
	importer?: IImporter;
}

/**
 * The public modules that a preview of one entry module loads, each with the place it comes from.
 *
 * The graph is the one of compiled public modules, read from what the host reports for each artifact: this
 * object compiles and classifies nothing. Where each module is loaded from is decided by `Routing`, and what a
 * module imports is found by the locator: on the disk (`DiskLocator`), at the version installed for the package
 * that imports it; or, for an installed workspace, by the edges of its execution projection
 * (`ProjectionLocator`). In an installed graph a package instance is walked again in every context that reaches
 * it, because the peers it imports are provided by the instances that reached it.
 *
 * Every address names the source of its package, as the host reports it (`origin`): npm and the workspace
 * unprefixed, another registry by its id. Two importers can reach two versions of one specifier: the first is the
 * import, and the other is given in the scope of its importer.
 */
export class Graph {
	#delivery: IBuildable;
	#selected: (module: IPublishedModule) => boolean;
	#addresses: Addresses;
	#locator: ILocator;
	#routing: Routing;
	#records = new Records();
	#holders = new Holders();
	#imports: Imports;
	#stylesheets: Stylesheets;

	#queue: IPending[] = [];
	#known: IPublishedModule[] = [];

	/**
	 * What was walked: a record, in the context of the instances that reached it
	 */
	#visited: Set<string> = new Set();

	get modules(): IPreviewModule[] {
		return this.#records.modules;
	}

	/**
	 * The import map of the graph: its imports, and the scopes of the importers that resolve another version
	 */
	get importmap() {
		return this.#imports.map;
	}

	get diagnostics(): IPreviewDiagnostic[] {
		return this.#records.diagnostics;
	}

	get updatable(): Record<string, IPreviewUpdatable> {
		return this.#records.updatable;
	}

	/**
	 * The runtime modules that the artifacts of the graph are assembled against
	 */
	get runtimes(): string[] {
		return this.#records.runtimes;
	}

	/**
	 * @param selected Whether a public module of the workspace is in development
	 * @param instances The installed graph the locator reads, when the workspace is served from one
	 */
	constructor(delivery: IBuildable, selected: (module: IPublishedModule) => boolean, addresses: Addresses, externals: Externals, locator: ILocator, instances?: Instances) {
		this.#delivery = delivery;
		this.#selected = selected;
		this.#addresses = addresses;
		this.#locator = locator;

		const records = this.#records;
		const report = (code: string, message: string) => records.report(code, message);
		this.#routing = new Routing({ delivery, selected, addresses, externals, records, installed: locator.installed });
		this.#imports = new Imports(report);

		const known = () => this.#known;
		const registry = (module: IPublishedModule) => this.#routing.registry(module);
		this.#stylesheets = new Stylesheets({ delivery, selected, addresses, externals, imports: this.#imports, instances, known, registry, report });
	}

	static specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	/**
	 * Gives an importer the address of a specifier: the import, or a scope of the importer. In an installed graph
	 * a second address for one importer is refused (`Imports.bind`).
	 */
	#place(specifier: string, url: string | undefined, importer?: IImporter): void {
		if (!url) return;
		if (!this.#locator.installed) return this.#imports.add(specifier, url, importer?.prefix);
		this.#imports.bind(specifier, url, importer?.prefix, importer ? Graph.specifier(importer.module) : specifier);
	}

	/**
	 * A module of a package the workspace does not contain, as its importer located it, and what it imports
	 *
	 * @returns The record and its id, which the stylesheet holders follow
	 */
	async #external(specifier: string, located: ILocated, importer: IImporter): Promise<{ id: string; module: IPreviewModule }> {
		const { name, version, subpath, registry } = located;
		const id = registry ? `${registry}:${name}@${version}/${subpath}` : `${specifier}\n${version ?? ''}`;
		const from = Graph.specifier(importer.module);
		const { module, known, delivered: compiled } = await this.#routing.record(id, specifier, located, from);

		// In an installed graph an import without an address fails with its reason, never taking another importer's
		if (this.#locator.installed && !module.url) {
			this.#imports.fail(specifier, `${this.#routing.code(id)}: "${specifier}" has no address: ${module.reason}`, importer.prefix, from);
			return { id, module };
		}
		this.#place(specifier, module.url, importer);

		// On the disk an installation resolves what it imports the same way for every importer
		if ((known && !this.#locator.installed) || module.source !== 'environment') return { id, module };

		const nested = await this.#locator.nested(located, importer, module.url);
		const visit = `${id}\n${nested.chain?.join('\n') ?? ''}`;
		if (this.#visited.has(visit)) return { id, module };
		this.#visited.add(visit);

		const request = { name, version, subpath, vspecifier: `${name}@${version}` };
		const { delivered } = compiled ? { delivered: compiled } : await this.#delivery.module(request, WEB);
		delivered?.styles && !known && (module.styles = this.#addresses.styles(name, version, subpath, registry));
		this.#place(`${specifier}.css`, module.styles, importer);
		await this.#stylesheets.select(module, delivered?.stylesheets, nested);
		if (nested.cycle) return { id, module };

		const dependencies = delivered?.dependencies?.filter(dependency => dependency.source !== 'builtin') ?? [];
		for (const dependency of dependencies) await this.#import(id, dependency, nested, false);
		return { id, module };
	}

	/**
	 * Resolves one public dependency of a module: a module of the workspace is walked in turn, anything else is a
	 * package the workspace does not contain
	 */
	async #import(from: string, dependency: IModuleDependency, importer: IImporter, runtime: boolean): Promise<void> {
		const located = await this.#locator.locate(dependency.specifier, importer, runtime, dependency.vspecifier, this.#known);
		if (located.local) {
			this.#holders.link(from, located.local.vspecifier);
			this.#queue.push({ module: located.local, specifier: dependency.specifier, importer });
			return;
		}
		const { id } = await this.#external(dependency.specifier, located, importer);
		this.#holders.link(from, id);
	}

	/**
	 * Adds a module of a package that the workspace does not contain, at the version its runtime resolves
	 * to, such as the coordinator of a runtime delivered by the CDN
	 *
	 * @returns The module, with its address when it has one; nothing when the workspace contains it
	 */
	async runtime(specifier: string, importer: IPublishedModule): Promise<IPreviewModule | undefined> {
		const own = this.#locator.local(importer, void 0);
		const located = await this.#locator.locate(specifier, own, true, void 0, this.#known);
		return located.local ? void 0 : (await this.#external(specifier, located, own)).module;
	}

	/**
	 * The module of the workspace that is the development coordinator of a runtime of the page (`<runtime>/main`)
	 */
	coordinator(specifier: string): IPublishedModule | undefined {
		return this.#locator.coordinator(specifier, this.#known);
	}

	/**
	 * Whether a package the entry can import publishes a public subpath, such as the coordinator of a runtime
	 */
	exports(specifier: string, entry: IPublishedModule): Promise<boolean> {
		return this.#locator.exports(specifier, this.#locator.local(entry, void 0), this.#known);
	}

	/**
	 * Marks the scope of every stylesheet of the graph: a module the given roots reach without crossing a
	 * widget is linked by the document, any other is adopted by the widgets that import it
	 */
	scope(roots: IPublishedModule[]) {
		const reached = this.#holders.reached(roots.map(root => root.vspecifier));
		for (const [id, module] of this.#records.entries()) {
			if (module.styles || module.stylesheets) module.scope = reached.has(id) ? 'document' : 'widget';
		}
	}

	/**
	 * The shared stylesheet of the package of a widget (`./global`, the optional style module every widget of the
	 * package adopts before its own). Nothing imports it, so it is described when a widget of its package is
	 * reached: the runtime then addresses its updates from the session, and finds it as `<package>/global.css`.
	 */
	#global(widget: IPublishedModule): void {
		const global = this.#known.find(one => one.name === widget.name && one.version === widget.version && one.subpath === './global');
		if (!global || !this.#selected(global)) return;
		const specifier = Graph.specifier(global);
		const { name, version, subpath } = global;
		this.#records.update(specifier, { package: name, vspecifier: global.vspecifier, path: this.#addresses.path(name, version, subpath) });
		this.#imports.add(`${specifier}.css`, this.#addresses.styles(name, version, subpath));
	}

	/**
	 * Walks the graph from the given workspace modules
	 */
	async walk(roots: IPublishedModule[], published: IPublishedModule[]): Promise<void> {
		this.#queue = roots.map(module => ({ module, specifier: Graph.specifier(module) }));
		this.#known = published;

		for (let pending = this.#queue.shift(); pending; pending = this.#queue.shift()) {
			const { module, importer } = pending;
			const id = module.vspecifier;
			const known = this.#records.get(id);
			const entry = known ?? this.#records.add(id, await this.#routing.workspace(module));
			// On the disk a module of the workspace is one specifier with one address, given once to the document
			this.#place(pending.specifier, entry.url, this.#locator.installed ? importer : void 0);

			const own = this.#locator.local(module, entry.url, importer);
			const visit = `${id}\n${own.chain?.join('\n') ?? ''}`;
			if (this.#visited.has(visit) || (known && !this.#locator.installed)) continue;
			this.#visited.add(visit);
			await this.#module(module, entry, own, !known);
		}
	}

	/**
	 * What one module of the workspace builds to and imports, walked in the context of its importer
	 *
	 * @param fresh Whether the module is described for the first time, rather than reached again in another context
	 */
	async #module(module: IPublishedModule, entry: IPreviewModule, own: IImporter, fresh: boolean): Promise<void> {
		const { delivered, failure } = await this.#delivery.module(module, WEB);
		if (!delivered) {
			for (const { code, message } of failure.diagnostics ?? [failure]) this.#records.report(code, `${entry.specifier}: ${message}`);
			return;
		}

		const { name, version, subpath } = module;
		if (fresh) {
			// The stylesheet of a module served here is held by the document or by the widgets that import the module;
			// any module's stylesheet is `<specifier>.css` in the import map, where the runtime finds it
			if (entry.vspecifier && delivered.styles) entry.styles = this.#addresses.styles(name, version, subpath);
			const sheet = entry.styles ?? (delivered.styles && this.#addresses.stylesheet(name, version, subpath, await this.#routing.registry(module)));
			sheet && this.#imports.add(`${entry.specifier}.css`, sheet);
			if (delivered.widget) {
				entry.widget = true;
				this.#holders.widget(module.vspecifier);
				this.#global(module);
			}
		}
		await this.#stylesheets.select(entry, delivered.stylesheets, own);
		if (own.cycle) return;

		// The runtime is imported by the artifact itself, not by its sources, so the host names it apart
		const { runtime } = delivered;
		runtime && this.#records.runtime(runtime);
		const dependencies = [...(runtime ? [{ specifier: runtime, source: 'runtime' }] : []), ...(delivered.dependencies ?? [])];
		for (const dependency of <IModuleDependency[]>dependencies) {
			if (dependency.source === 'builtin') {
				this.#records.report('PREVIEW_BUILTIN', `"${entry.specifier}" imports the Node builtin "${dependency.specifier}", which a browser does not provide`);
				continue;
			}
			await this.#import(module.vspecifier, dependency, own, dependency.source === 'runtime');
		}
	}
}
