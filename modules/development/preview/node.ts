import type { IBuildable, IModuleDependency, IPublishedModule } from '../builds';
import type { Addresses } from './addresses';
import { Externals } from './externals';
import { Redaction } from './redaction';
import type { ITraced, ITracedEdge } from './trace';
import type { ICompositionOutput } from './types';

const NODE = { platform: 'node', environment: 'development' };

/**
 * A module the Node consumer reaches, with its Node output
 */
export interface INodeReached {
	specifier: string;
	traced: ITraced;
	output: ICompositionOutput;
}

/**
 * What a Node consumer of this environment loads: the Node output of each public module of the workspace that
 * declares Node, and what each one imports.
 *
 * In development a Node consumer (`beyond run`, BEE Node's `packages` adapter) loads every public module of the
 * workspace from this environment, the packages the toolchain supplies among them, whatever the selection says,
 * and resolves every other package with Node's own resolution from the installation. The externals policy is the
 * page's: nothing here is asked of the CDN.
 */
export class NodeGraph {
	#delivery: IBuildable;
	#addresses: Addresses;
	#externals: Externals;
	#reached: Map<string, INodeReached> = new Map();
	#edges: ITracedEdge[] = [];

	/**
	 * The modules reached, by identity: the versioned identity of a module of the workspace, `<name>@<version>` and
	 * its subpath for an installed package
	 */
	get reached(): ReadonlyMap<string, INodeReached> {
		return this.#reached;
	}

	get edges(): ITracedEdge[] {
		return this.#edges;
	}

	constructor(delivery: IBuildable, addresses: Addresses, externals: Externals) {
		this.#delivery = delivery;
		this.#addresses = addresses;
		this.#externals = externals;
	}

	static #specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	/**
	 * Builds the given modules for Node and follows what they import
	 */
	async walk(roots: IPublishedModule[], published: IPublishedModule[]): Promise<void> {
		const queue = [...roots];
		for (let module = queue.shift(); module; module = queue.shift()) {
			if (this.#reached.has(module.vspecifier) || (await this.#externals.style(module))) continue;

			const { delivered, failure } = await this.#delivery.module(module, NODE);
			const diagnostics = failure?.diagnostics ?? (failure ? [failure] : []);
			if (failure && diagnostics.every(({ code }) => code === 'CONDITIONAL_NOT_FOUND')) continue;

			const { name, version, subpath, vspecifier, path } = module;
			const source = module.supplied ? 'environment' : 'workspace';
			const output: ICompositionOutput = delivered
				? { source, state: 'built', hash: delivered.hash, address: this.#addresses.node(name, version, subpath) }
				: { source, state: 'failed', reason: Redaction.text(diagnostics.map(({ message }) => message).join('; ')) };
			const traced: ITraced = { name, version, subpath, vspecifier, path, provider: module.supplied ? 'toolchain' : 'workspace' };
			this.#reached.set(vspecifier, { specifier: NodeGraph.#specifier(module), traced, output });
			if (!delivered) continue;

			const runtime = delivered.runtime ? [{ specifier: delivered.runtime, source: 'runtime' }] : [];
			for (const dependency of <IModuleDependency[]>[...runtime, ...(delivered.dependencies ?? [])]) {
				if (dependency.source === 'builtin') {
					(output.builtins ??= []).push(dependency.specifier);
					continue;
				}
				const local = published.find(one => (dependency.vspecifier ? one.vspecifier === dependency.vspecifier : NodeGraph.#specifier(one) === dependency.specifier));
				const to = local ? local.vspecifier : await this.#installed(dependency.specifier, module);
				local && queue.push(local);
				this.#edges.push({ from: vspecifier, to, specifier: dependency.specifier, ...(dependency.source === 'runtime' ? { runtime: true } : {}) });
			}
		}
	}

	/**
	 * A package the workspace does not contain, as Node resolves it for the module that imports it
	 *
	 * @returns Its identity
	 */
	async #installed(specifier: string, importer: IPublishedModule): Promise<string> {
		const { name, subpath, version, reason } = await this.#externals.resolve(specifier, importer.path);
		const id = `${name}${version ? `@${version}` : ''}${subpath === '.' ? '' : `/${subpath.slice(2)}`}`;
		if (this.#reached.has(id)) return id;

		// The registry its installation came from names it, as it names the same installation on the page
		const path = version ? await this.#externals.root(name, importer.path) : void 0;
		const registry = version ? ((await this.#delivery.origin?.(name, version)) ?? { registry: 'npm' }).registry : void 0;
		const output: ICompositionOutput = version
			? { source: 'environment', state: 'unknown', reason: 'Resolved by the Node consumer from the installation' }
			: { source: 'unresolved', state: 'unknown', reason };
		const traced: ITraced = { name, version, subpath, provider: version ? 'installation' : 'registry', ...(registry ? { registry } : {}), ...(path ? { path } : {}) };
		this.#reached.set(id, { specifier, traced, output });
		return id;
	}
}
