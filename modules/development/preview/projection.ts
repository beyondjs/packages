import type { IPublishedModule } from '../builds';
import type { IImporter, ILocated, ILocator } from './locator';
import type { IBound, Instances } from './instances';
import { Addresses } from './addresses';
import { Externals } from './externals';

/**
 * What the modules of an installed workspace import, by the edges of its execution projection.
 *
 * Every importer is an instance of the installed graph, and the package it imports is the instance its own edges
 * select: a member of the workspace, whose public modules the workspace publishes, or a node of the store, which
 * this environment serves (no node of the graph is asked of the CDN). A peer is the release provided by an
 * instance that reached the importer, so an importer carries the chain of instances that reached it. Nothing is
 * looked for on the disk and nothing falls back to the installation of the toolchain.
 *
 * The runtime that composed artifacts import (`source: 'runtime'`: the bundler's runtime package and the Kernel
 * identities mapped to it) is not a dependency a package declares: it is the runtime of the page. It is the
 * instance the entry's package depends on, else the only instance of that name in the installed graph, and every
 * runtime import of the page reaches it; otherwise it is `RUNTIME_NOT_INSTALLED`.
 */
export class ProjectionLocator implements ILocator {
	readonly installed = true;

	#instances: Instances;
	#entry: IPublishedModule | undefined;

	/**
	 * The runtime instance of the page, by package name: decided once, so one page reaches one runtime
	 */
	#runtimes: Map<string, IBound> = new Map();

	/**
	 * @param entry The entry module of the page, whose package decides the runtime of the page
	 */
	constructor(instances: Instances, entry?: IPublishedModule) {
		this.#instances = instances;
		this.#entry = entry;
	}

	/**
	 * The runtime instance of the page for a runtime package
	 */
	#runtime(name: string): IBound {
		if (this.#runtimes.has(name)) return this.#runtimes.get(name);

		const entry = this.#entry && this.#instances.importer(this.#entry);
		const own = entry ? this.#instances.bind(entry, name, []) : void 0;
		const keys = this.#instances.find(name);
		const only = keys.length === 1 ? this.#instances.complete({ key: keys[0] }) : void 0;
		const detail = keys.length ? `the installed graph has ${keys.length} instances of it and the application depends on none` : 'the installed graph does not have it';
		const decided = own?.key ? own : only?.key ? only : { error: { code: 'RUNTIME_NOT_INSTALLED', message: detail } };
		this.#runtimes.set(name, decided);
		return decided;
	}

	async locate(specifier: string, importer: IImporter, runtime: boolean, vspecifier: string | undefined, published: IPublishedModule[]): Promise<ILocated> {
		const { name, subpath } = Externals.parse(specifier);

		// An importer of the graph binds by its edges and the chain that reached it, never by the host's classification,
		// which binds a member's peer as the member developed on its own
		const bound = runtime ? this.#runtime(name) : importer.key ? this.#instances.bind(importer.key, name, importer.chain ?? []) : void 0;
		if (!bound) {
			const classified = vspecifier && published.find(one => one.vspecifier === vspecifier);
			if (classified) return { local: classified, name: classified.name, subpath: classified.subpath };
			const reason = 'the package that imports it is not in the installed graph of the workspace: run beyond install';
			return { name, subpath, code: 'DEPENDENCY_NOT_INSTALLED', reason };
		}
		if (bound.error) return { name, subpath, code: bound.error.code, reason: this.#reason(name, importer, bound.error) };

		const { key, node } = bound;
		if (this.#instances.member(node)) {
			const local = published.find(one => one.name === node.name && one.version === node.version && one.subpath === subpath);
			if (local) return { local, name, subpath };
			const reason = `the member "${node.name}@${node.version}" of the workspace publishes no module "${subpath}"`;
			return { name, subpath, code: 'MODULE_NOT_FOUND', reason };
		}

		const origin = await this.#instances.origin(node);
		const { version, location } = node;
		return { name: node.name, subpath, version, registry: origin.registry, unsupported: origin.reason, served: true, key, location };
	}

	#reason(name: string, importer: IImporter, error: { code: string; message: string }): string {
		if (error.code !== 'RUNTIME_NOT_INSTALLED') return error.message;
		const application = this.#entry ? `the application "${this.#entry.name}"` : 'the application';
		return `"${name}" is the runtime of "${importer.module.vspecifier}"; declare it in ${application} and run beyond install (${error.message})`;
	}

	local(module: IPublishedModule, url: string | undefined, importer?: IImporter): IImporter {
		const key = this.#instances.importer(module);
		const prefix = url && Addresses.prefix(url);
		if (!importer?.key) return { module, path: module.path, prefix, key, chain: [] };
		if (key === importer.key) return { module, path: module.path, prefix, key, chain: importer.chain ?? [] };

		const chain = this.#instances.extend(importer.key, importer.chain ?? []);
		return { module, path: module.path, prefix, key, chain, cycle: chain.includes(key) };
	}

	async nested(located: ILocated, importer: IImporter, url: string): Promise<IImporter> {
		const prefix = Addresses.prefix(url);
		// Another subpath of the same package imports in the context of its importer: it is not a cycle
		if (located.key === importer.key) return { module: importer.module, path: located.location, prefix, key: importer.key, chain: importer.chain ?? [] };

		const chain = importer.key ? this.#instances.extend(importer.key, importer.chain ?? []) : [];
		return { module: importer.module, path: located.location, prefix, key: located.key, chain, cycle: chain.includes(located.key) };
	}

	/**
	 * Whether the runtime of the page publishes a subpath, such as its development coordinator
	 */
	async exports(specifier: string, importer: IImporter, published: IPublishedModule[]): Promise<boolean> {
		void importer;
		const { name, subpath } = Externals.parse(specifier);
		const { node } = this.#runtime(name);
		if (!node) return false;
		if (!this.#instances.member(node)) return this.#instances.exports(node, subpath);
		return published.some(one => one.name === node.name && one.version === node.version && one.subpath === subpath);
	}

	/**
	 * The coordinator of the runtime instance of the page, when that instance is a member of the workspace; none for a
	 * runtime the page has no instance of, whatever versions of it the workspace publishes
	 */
	coordinator(specifier: string, published: IPublishedModule[]): IPublishedModule | undefined {
		const { name, subpath } = Externals.parse(specifier);
		const { node } = this.#runtime(name);
		if (!node || !this.#instances.member(node)) return;
		return published.find(one => one.name === node.name && one.version === node.version && one.subpath === subpath);
	}
}
