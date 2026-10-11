import { promises as fs } from 'fs';
import { join } from 'path';
import type { IBuildable, IPublishedModule } from '../builds';
import type { Addresses } from './addresses';
import type { Externals } from './externals';
import type { Graph } from './graph';
import { NodeGraph } from './node';
import type { IProbed } from './probe';
import { Redaction } from './redaction';
import type { ITraced, ITracedEdge } from './trace';
import type {
	ICompositionDocument,
	ICompositionEdge,
	ICompositionModule,
	ICompositionOutput,
	ICompositionPackage,
	IPreviewModule
} from './types';
import type { IPreviewDescription } from './index';

const WEB = { platform: 'web', environment: 'development' };
const KINDS = <const>['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];

/**
 * What one preview walk produced, which the composition is built from
 */
export interface IWalked {
	description: IPreviewDescription;
	graph: Graph;
	published: IPublishedModule[];

	/**
	 * What the CDN answered for the address of each module of the page that has one there, by its record
	 */
	answers: Map<IPreviewModule, IProbed>;
}

/**
 * The composition document of one entry: the packages, the public modules and the public dependencies the page of
 * the entry loads, and what a Node consumer of this environment loads of the workspace.
 *
 * It describes; it decides nothing. Where each web output comes from is what the preview decided for the page
 * (the walk of [Graph](./graph.ts), the selection and the externals policy), its hash is this environment's build
 * of it, and an output on the CDN carries what the CDN answered when its address was checked. Node outputs are
 * this environment's builds ([NodeGraph](./node.ts)). Packages, modules and their dependencies are separate lists:
 * the package graph is what each manifest declares, with the versions this composition reached; the module graph
 * is the public imports; the files of a module are the file contract's and are not repeated here.
 */
export class Composition {
	static PROTOCOL = <const>'beyond-dev-composition/1';

	#delivery: IBuildable;
	#addresses: Addresses;
	#externals: Externals;
	#modules: Map<string, ICompositionModule> = new Map();
	#packages: Map<string, ITraced> = new Map();
	#edges: ICompositionEdge[] = [];

	constructor(delivery: IBuildable, addresses: Addresses, externals: Externals) {
		this.#delivery = delivery;
		this.#addresses = addresses;
		this.#externals = externals;
	}

	/**
	 * The package identity: `<name>@<version>`, with the registry id first for a package of a registry other than npm
	 */
	static package({ name, version, registry, provider }: ITraced): string {
		const prefixed = registry && registry !== 'npm' && !['workspace', 'toolchain'].includes(provider);
		return `${prefixed ? `${registry}:` : ''}${name}${version ? `@${version}` : ''}`;
	}

	static module(traced: ITraced): string {
		const id = Composition.package(traced);
		return traced.subpath === '.' ? id : `${id}/${traced.subpath.replace(/^\.\//, '')}`;
	}

	async document({ description, graph, published, answers }: IWalked): Promise<ICompositionDocument> {
		const ids: Map<string, string> = new Map();
		for (const [id, record] of graph.entries()) {
			const traced = graph.trace.nodes.get(id);
			if (!traced) continue;
			const module = this.#module(traced, record.specifier, record.source !== 'unresolved');
			record.widget && (module.widget = true);
			module.outputs.web = await this.#web(record, traced, published, answers.get(record));
			module.platforms = ['web'];
			ids.set(id, module.id);
		}
		this.#edge(graph.trace.edges, 'web', id => ids.get(id));

		// Every module of the workspace that declares Node, and what it reaches; the packages the toolchain supplies
		// enter only when a module imports them
		const nodes = new NodeGraph(this.#delivery, this.#addresses, this.#externals);
		await nodes.walk(published.filter(module => !module.supplied), published);
		const reached: Map<string, string> = new Map();
		for (const [key, { specifier, traced, output }] of nodes.reached) {
			const module = this.#modules.get(Composition.module(traced)) ?? this.#module(traced, specifier, false);
			module.outputs.node = output;
			!module.platforms.includes('node') && module.platforms.push('node');
			reached.set(key, module.id);
		}
		this.#edge(nodes.edges, 'node', id => reached.get(id));

		const { entry, selection, cdn, diagnostics } = description;
		const modules = [...this.#modules.values()].sort((a, b) => a.id.localeCompare(b.id));
		const edges = this.#edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.platform.localeCompare(b.platform));
		const packages = await Promise.all([...this.#packages.entries()].map(([id, traced]) => this.#package(id, traced, modules, edges)));
		return { protocol: Composition.PROTOCOL, entry, selection, cdn, packages: packages.sort((a, b) => a.id.localeCompare(b.id)), modules, edges, diagnostics };
	}

	#module(traced: ITraced, specifier: string, loaded: boolean): ICompositionModule {
		const id = Composition.module(traced);
		const known = this.#modules.get(id);
		if (known) return known;

		const pkg = Composition.package(traced);
		!this.#packages.has(pkg) && this.#packages.set(pkg, traced);
		const { subpath, vspecifier } = traced;
		const module: ICompositionModule = { id, specifier, package: pkg, subpath, ...(vspecifier ? { vspecifier } : {}), loaded, platforms: [], outputs: {} };
		this.#modules.set(id, module);
		return module;
	}

	#edge(traced: ITracedEdge[], platform: 'web' | 'node', id: (record: string) => string | undefined): void {
		for (const { from, to, specifier, runtime } of traced) {
			const [source, target] = [id(from), id(to)];
			if (!source || !target) continue;
			// One edge per dependency; a runtime that the sources also import is an import of the sources
			const known = this.#edges.find(edge => edge.from === source && edge.to === target && edge.specifier === specifier && edge.platform === platform);
			if (known) !runtime && delete known.runtime;
			else this.#edges.push({ from: source, to: target, specifier, platform, ...(runtime ? { runtime } : {}) });
		}
	}

	/**
	 * The web output of a record of the page: this environment's build for what it serves, the CDN's answer for an
	 * address there, the reason for what has no address
	 */
	async #web(record: IPreviewModule, traced: ITraced, published: IPublishedModule[], answer: IProbed | undefined): Promise<ICompositionOutput> {
		const { url: address, reason } = record;
		const described = { ...(address ? { address } : {}), ...(reason ? { reason } : {}) };
		if (record.source === 'cdn') {
			const state = answer?.state === 'present' ? 'prepared' : 'unknown';
			return { source: 'cdn', state, ...described, ...(answer?.digest ? { digest: answer.digest } : {}) };
		}
		// What the CDN answered for an address it could not be bound to, or nothing measured
		if (record.source === 'unresolved') return { source: 'unresolved', state: answer && answer.state !== 'present' ? answer.state : 'unknown', ...described };

		const { name, version, subpath, vspecifier, provider } = traced;
		const module = vspecifier ? published.find(one => one.vspecifier === vspecifier) : void 0;
		const request = module ?? { name, version, subpath, vspecifier: `${name}@${version}` };
		const { delivered, failure } = await this.#delivery.module(request, WEB);
		const source = provider === 'workspace' ? 'workspace' : 'environment';
		if (delivered) return { source, state: 'built', hash: delivered.hash, ...described };
		return { source, state: 'failed', ...described, reason: Redaction.text(reason ?? failure?.message ?? 'The build failed') };
	}

	async #package(id: string, traced: ITraced, modules: ICompositionModule[], edges: ICompositionEdge[]): Promise<ICompositionPackage> {
		const own = modules.filter(module => module.package === id);
		const outputs = own.flatMap(module => [module.outputs.web, module.outputs.node].filter(output => !!output));
		const sources = [...new Set(outputs.map(output => output.source))];
		const reasons = [...new Set(outputs.map(output => output.reason))];
		const { name, version, provider, registry } = traced;

		const described: ICompositionPackage = {
			id,
			name,
			...(version ? { version } : {}),
			source: sources.length === 1 ? sources[0] : 'mixed',
			...(reasons.length === 1 && reasons[0] ? { reason: reasons[0] } : {}),
			provider,
			...(registry ? { registry } : {})
		};
		const manifest = traced.path ? await this.#manifest(traced.path) : void 0;
		if (!manifest) return described;

		// The versions of each declared name that the modules of this package reach in this composition
		const targets = edges.filter(edge => own.some(module => module.id === edge.from)).map(edge => this.#packages.get(this.#modules.get(edge.to)?.package));
		const reached = (dependency: string) => [...new Set(targets.filter(target => target?.name === dependency).map(target => target.version))].sort();
		described.dependencies = KINDS.flatMap(kind =>
			Object.entries(<Record<string, unknown>>(manifest[kind] ?? {}))
				.filter(([, range]) => typeof range === 'string')
				.map(([dependency, range]) => ({ name: dependency, range: <string>range, kind, resolved: reached(dependency) }))
		);
		return described;
	}

	async #manifest(path: string): Promise<Record<string, any> | undefined> {
		try {
			return JSON.parse(await fs.readFile(join(path, 'package.json'), 'utf8'));
		} catch {
			return void 0;
		}
	}
}
