import type { IInstallationDiagnostic, IInstalledGraph } from './types';
import { type ILimits, type SourcesTransport, Sources, FilesystemStore, Limits } from '@beyond-js/packages/sources';
import { type IGraphDocument, Canonical } from '@beyond-js/packages/resolution';

/**
 * Whoever knows the credentials of a private archive
 */
interface IAuthorizer {
	authorize(pkg: string, url: string): Promise<Record<string, string>>;
}

/**
 * What fetching the external nodes of a graph established
 */
export interface IFetched {
	complete: boolean;
	// Node key → the directory of its verified sources, for every external node that is in the store
	locations: Map<string, string>;
	fetched: number;
	reused: number;
	diagnostics: IInstallationDiagnostic[];
}

/**
 * Brings every external node of a graph into the source store of the user with `Sources.fetch`: a member is
 * already on disk and is never fetched. Offline, no request is made, so a node the store does not hold is
 * `OFFLINE_UNAVAILABLE`. The stages a previous process abandoned are removed before anything is fetched.
 */
export class Fetching {
	#store: FilesystemStore;
	#limits: ILimits;
	#authorizer: () => IAuthorizer;
	#transport?: SourcesTransport;
	#offline: boolean;

	/**
	 * @param authorizer Creates whoever knows the credentials, only if a private node needs them
	 */
	constructor(
		store: string,
		limits: ILimits,
		authorizer: () => IAuthorizer,
		transport: SourcesTransport,
		offline: boolean
	) {
		this.#limits = limits || {};
		this.#store = new FilesystemStore(store, { timeout: new Limits(this.#limits).timeout });
		this.#authorizer = authorizer;
		this.#transport = transport;
		this.#offline = offline;
	}

	/**
	 * The `beyond-graph/1` document of the external nodes: their exceptions travel with them, so a git source
	 * without a published integrity gets one established at fetch
	 */
	#subset(graph: IInstalledGraph): IGraphDocument {
		const nodes: Record<string, any> = {};
		for (const [key, node] of Object.entries(graph.nodes)) {
			if (!key.startsWith('workspace:') && node.origin?.provider !== 'workspace') nodes[key] = node;
		}
		const exceptions = (graph.exceptions || []).filter(({ node }) =>
			Object.prototype.hasOwnProperty.call(nodes, node)
		);

		const content = {
			protocol: <const>'beyond-graph/1',
			roots: <IGraphDocument['roots']>[],
			nodes,
			edges: <IGraphDocument['edges']>[],
			overrides: <IGraphDocument['overrides']>[],
			lock: { reused: false },
			exceptions: <IGraphDocument['exceptions']>exceptions,
			diagnostics: <IGraphDocument['diagnostics']>[]
		};
		return { ...content, digest: Canonical.digest(content) };
	}

	async run(graph: IInstalledGraph): Promise<IFetched> {
		const subset = this.#subset(graph);
		// Cleaning is housekeeping: a store whose stages cannot be listed still serves what it holds
		await this.#store.clean().catch((): number => 0);

		// A refused destination keeps its code through the fetch, which tells it from any other failure of a node
		const refuse: SourcesTransport = async (url: string) => {
			throw Object.assign(new Error(`The installation is offline: ${new URL(url).host} was not requested`), {
				code: 'DESTINATION_REFUSED'
			});
		};
		const authorizer = { authorize: (pkg: string, url: string) => this.#authorizer().authorize(pkg, url) };
		const transport = this.#offline ? refuse : this.#transport;
		const report = await Sources.fetch(subset, this.#store, this.#limits, 'local', authorizer, transport);

		const locations = new Map<string, string>();
		report.packages.forEach(({ node, location }) => location && locations.set(node, location));
		const fetched = report.packages.filter(({ reused }) => !reused).length;
		const reused = report.packages.length - fetched;

		const diagnostics = report.diagnostics.map(({ code, message, node }) => {
			const refused = this.#offline && node && code === 'DESTINATION_REFUSED';
			if (!refused) return { code, message, severity: <const>'error', ...(node ? { node } : {}) };
			const { name, version } = subset.nodes[node] || <any>{};
			const missing = `${name}@${version} is not in the source store, and the installation is offline`;
			return { code: 'OFFLINE_UNAVAILABLE', message: missing, severity: <const>'error', node };
		});
		const total = Object.keys(subset.nodes).length;
		const complete = report.complete && locations.size === total;
		if (report.complete && !complete) {
			const message = 'The source store did not report where the sources of every node are';
			diagnostics.push({ code: 'SOURCES_INCOMPLETE', message, severity: 'error' });
		}
		return { complete, locations, fetched, reused, diagnostics };
	}
}
