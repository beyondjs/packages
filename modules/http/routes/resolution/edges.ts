import type { Delivery, IDelivered, IPublished } from '@beyond-js/packages/artifacts';
import { type Options, Identity, ModulePath, ResourcePath } from '@beyond-js/artifact-api';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { IInstance, Instances } from '../instances';
import type { Table } from './table';
import { Walk } from './walk';

/**
 * An importer of the walk: an instance of the installed graph, the instances that reached it (nearest first),
 * which decide the peers it binds, and the package prefix of its address, which is its scope
 */
interface IImporter {
	key: string;
	chain: string[];
	prefix: string;
}

/**
 * What the browser modules of an installed workspace import, walked by the edges of its execution projection for
 * one resolution document.
 *
 * The runtime that composed artifacts import (`source: 'runtime'`) is not a dependency a package declares, and a
 * document of the whole workspace has no application to decide it: it is the only instance of its name in the
 * installed graph, and every runtime import of the document reaches it. None, or several, is
 * `RUNTIME_NOT_INSTALLED`, which the document cannot be written without.
 *
 * Every importer is an instance of the installed graph, and what it imports is the instance its own edges select:
 * a member of the workspace (unprefixed) or a node of the store, addressed under the registry of its provider. A
 * peer is the release provided by an instance that reached the importer, so the walk follows every path from the
 * modules of the workspace, and an instance is walked again when it is reached through other instances.
 *
 * A document gives an importer one address per specifier. An instance that two paths bind to two releases of a
 * peer, as two applications that provide two versions of React to one library do, cannot be written in one
 * document: it is reported as `PEER_CONTEXT_AMBIGUOUS`, and so is a peer that none of the instances that reached
 * the importer decides. An import that has no address cannot be left out either, because its importer would take
 * the address another importer was given: an import the graph does not provide (`DEPENDENCY_NOT_INSTALLED`), a node
 * taken from Git or from an archive address (`SOURCE_UNSUPPORTED`) and a node of the store that does not build or
 * whose sources are missing are reported, and the document is not written. A member that does not build keeps its
 * address, which answers its build failure while it is developed.
 */
export class Edges {
	#delivery: Delivery;
	#instances: Instances;
	#options: Options;
	#table: Table;

	#visited: Set<string> = new Set();

	/**
	 * What the delivery answered for each module of the walk, asked once per document
	 */
	#compiled: Map<string, ReturnType<Delivery['module']>> = new Map();

	/**
	 * The runtime instance of the document by package name, or why there is none
	 */
	#runtimes: Map<string, { key?: string; node?: IInstance; reason?: string }> = new Map();

	/**
	 * The address each importer was given for each specifier, and through which application
	 */
	#bound: Map<string, { url: string; via: string }> = new Map();

	#diagnostics: { code: string; message: string }[] = [];

	/**
	 * The bindings that one document cannot hold
	 */
	get diagnostics() {
		return this.#diagnostics;
	}

	constructor(delivery: Delivery, instances: Instances, options: Options, table: Table) {
		this.#delivery = delivery;
		this.#instances = instances;
		this.#options = options;
		this.#table = table;
	}

	/**
	 * Walks what a public module of the workspace imports, from the instance of its package
	 *
	 * @param path The module path of its address
	 */
	async root(module: IPublished, delivered: IDelivered, path: string): Promise<void> {
		const key = this.#instances.importer(module);
		// A member the projection does not know has no edges to follow: its build reports what it imports
		if (!key) return;
		await this.#walk(delivered, { key, chain: [], prefix: Walk.prefix(path) }, module.subpath);
	}

	async #walk(delivered: IDelivered, importer: IImporter, subpath: string): Promise<void> {
		const id = [importer.key, subpath, ...importer.chain].join('\n');
		if (this.#visited.has(id)) return;
		this.#visited.add(id);

		// The runtime a composed module imports is named apart: it is the runtime of the document
		const imports = new Map<string, boolean>();
		for (const { specifier, source } of delivered.dependencies ?? []) source !== 'builtin' && imports.set(specifier, source === 'runtime');
		delivered.runtime && imports.set(delivered.runtime, true);
		for (const [specifier, runtime] of imports) await this.#import(specifier, importer, runtime);
		for (const specifier of delivered.stylesheets ?? []) await this.#stylesheet(specifier, importer);
	}

	/**
	 * The runtime instance of the document for a runtime package, reported when there is none
	 */
	#runtime(name: string, importer: IImporter): { key: string; node: IInstance } | undefined {
		if (!this.#runtimes.has(name)) {
			const keys = this.#instances.find(name);
			const node = keys.length === 1 ? this.#instances.node(keys[0]) : void 0;
			const reason = keys.length ? `the installed graph has ${keys.length} instances of it` : 'the installed graph does not have it';
			this.#runtimes.set(name, node ? { key: keys[0], node } : { reason });
		}
		const { key, node, reason } = this.#runtimes.get(name);
		if (key && node) return { key, node };
		this.#report('RUNTIME_NOT_INSTALLED', `"${name}" is the runtime of "${this.#name(importer.key)}"; declare it in the application and run beyond install (${reason})`);
	}

	async #import(specifier: string, importer: IImporter, runtime: boolean): Promise<void> {
		const { name, subpath } = Walk.parse(specifier);
		const bound = runtime ? this.#runtime(name, importer) : this.#resolve(name, specifier, importer);
		if (!bound) return;

		const registry = this.#registry(bound.node, specifier, importer);
		if (!registry) return;

		const { key, node } = bound;
		const id = `${key}\n${subpath}`;
		this.#compiled.has(id) || this.#compiled.set(id, this.#delivery.module({ name: node.name, version: node.version, subpath }, this.#options.conditions));
		const { delivered, failure } = await this.#compiled.get(id);
		if (!delivered && !(this.#instances.member(node) && failure?.code === 'BUILD_FAILED')) {
			const cause = failure?.diagnostics?.find(({ code }) => code === 'SOURCE_MISSING') ?? failure;
			return this.#report(cause?.code ?? 'BUILD_FAILED', `"${this.#name(importer.key)}" imports "${specifier}", which has no output: ${cause?.message}`);
		}

		const identity = new Identity({ registry, name: node.name, version: node.version, subpath });
		const path = ModulePath.format(identity);
		this.#place(specifier, `${path}?${this.#options.query}`, importer);
		if (!delivered) return;
		delivered.styles && this.#place(`${specifier}.css`, this.#style(identity), importer);

		// Another module of the same instance imports in the same context; an instance that reached the importer is a cycle
		if (key === importer.key) return this.#walk(delivered, importer, subpath);
		if (importer.chain.includes(key)) return;
		await this.#walk(delivered, { key, chain: this.#instances.extend(importer.key, importer.chain), prefix: Walk.prefix(path) }, subpath);
	}

	/**
	 * The registry an instance is addressed under; one taken from Git or from an archive address is not served
	 */
	#registry(node: IInstance, specifier: string, importer: IImporter): string | undefined {
		const { registry, reason } = this.#instances.origin(node);
		registry ?? this.#report('SOURCE_UNSUPPORTED', `"${this.#name(importer.key)}" imports "${specifier}": ${reason}`);
		return registry;
	}

	/**
	 * A stylesheet selected by specifier (`pkg/sub.css`): the stylesheet of the public module `./sub` of the
	 * instance the importer binds `pkg` to, unless that package publishes `./sub.css` itself
	 */
	async #stylesheet(specifier: string, importer: IImporter): Promise<void> {
		const literal = Walk.parse(specifier);
		const bound = this.#resolve(literal.name, specifier, importer);
		const registry = bound && this.#registry(bound.node, specifier, importer);
		if (!registry) return;

		const { node } = bound;
		const subpath = (await this.#exported(node, literal.subpath)) ? literal.subpath : Walk.parse(specifier.replace(/\.css$/, '')).subpath;
		this.#place(specifier, this.#style(new Identity({ registry, name: node.name, version: node.version, subpath })), importer);
	}

	/**
	 * Whether a package publishes a subpath literally: a member by its public modules, an installation by its
	 * `exports`, read where the installation is
	 */
	async #exported(node: IInstance, subpath: string): Promise<boolean> {
		if (this.#instances.member(node)) {
			const published = await this.#delivery.published();
			return published.some(module => module.name === node.name && module.version === node.version && module.subpath === subpath);
		}
		try {
			const { exports } = JSON.parse(await fs.readFile(join(node.location, 'package.json'), 'utf8'));
			return !!exports && typeof exports === 'object' && Object.prototype.hasOwnProperty.call(exports, subpath);
		} catch {
			return false;
		}
	}

	#style(identity: Identity): string {
		return `${ResourcePath.format({ kind: 'style', identity })}?${this.#options.query}`;
	}

	/**
	 * The instance an importer binds a package to, or nothing, which is reported
	 */
	#resolve(name: string, specifier: string, importer: IImporter): { key: string; node: IInstance } | undefined {
		const bound = this.#instances.bind(importer.key, name, importer.chain);
		if (bound.key && bound.node) return { key: bound.key, node: bound.node };
		if (bound.error?.code !== 'PEER_CONTEXT_AMBIGUOUS') {
			const message = bound.error?.message ?? `"${this.#name(importer.key)}" imports "${specifier}", which its graph does not provide`;
			return void this.#report(bound.error?.code ?? 'DEPENDENCY_NOT_INSTALLED', message);
		}

		const through = importer.chain.length ? `, reached through ${importer.chain.map(key => this.#name(key)).join(' < ')},` : '';
		const message = `"${this.#name(importer.key)}"${through} imports "${specifier}", a peer its graph binds to a different release for each instance that provides it, and none of the instances that reached it here provides it`;
		this.#report('PEER_CONTEXT_AMBIGUOUS', message);
	}

	/**
	 * Gives an importer the address of a specifier, unless it was given another one in this document
	 */
	#place(specifier: string, url: string, importer: IImporter): void {
		const id = `${importer.prefix}\n${specifier}`;
		const via = this.#name(importer.chain[importer.chain.length - 1] ?? importer.key);
		const previous = this.#bound.get(id);
		if (previous && previous.url !== url) {
			const [first, second] = [previous.url, url].map(one => one.split('?')[0]);
			const message =
				`"${this.#name(importer.key)}" imports "${specifier}" as ${first} through "${previous.via}" and as ${second} through "${via}": ` +
				'one document gives one release one address for each specifier it imports';
			return this.#report('PEER_CONTEXT_AMBIGUOUS', message);
		}
		previous ?? this.#bound.set(id, { url, via });
		this.#table.add(specifier, url, importer.prefix);
	}

	#name(key: string): string {
		const node = this.#instances.node(key);
		return node ? `${node.name}@${node.version}` : key;
	}

	#report(code: string, message: string): void {
		!this.#diagnostics.some(one => one.message === message) && this.#diagnostics.push({ code, message });
	}
}
