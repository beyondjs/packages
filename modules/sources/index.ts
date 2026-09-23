import type { IGraphDocument } from '@beyond-js/packages/resolution';
import type { IStore, ILimits, ISourcesReport, ISourceResult, ISourceDiagnostic } from './types';
import { type IAuthorizer, type SourcesTransport, Download } from './download';
import { Limits } from './limits';
import { Queue } from './queue';

/**
 * Second stage of a published build: brings every package of a pinned graph into a store.
 *
 * It fetches the whole graph at once, never progressively as modules are generated, and it analyses
 * nothing: what an application reaches is decided later, over sources that are already durable.
 */
export /*bundle*/ class Sources {
	/**
	 * Downloads every package of the graph that the store does not hold, verifies it and publishes it.
	 * The call returns once every package was dealt with.
	 *
	 * Failures are returned as diagnostics: `complete` is true only when every package of the graph is
	 * in the store, verified. A package that fails leaves nothing in the store.
	 *
	 * @param graph A `beyond-graph/1` document without error diagnostics
	 * @param store Where verified sources are kept
	 * @param limits Bounds of each archive and of the fetch
	 * @param tenant The organization private packages are stored for
	 * @param authorizer The providers that know the credentials, required for private packages. Only a
	 *   private node is downloaded with a credential: a public node is downloaded anonymously
	 * @param transport How archives are requested; the global `fetch` when absent
	 */
	static async fetch(
		graph: IGraphDocument,
		store: IStore,
		limits?: ILimits,
		tenant?: string,
		authorizer?: IAuthorizer,
		transport?: SourcesTransport
	): Promise<ISourcesReport> {
		const report = (packages: ISourceResult[], diagnostics: ISourceDiagnostic[]): ISourcesReport => {
			const order = (a: { node?: string }, b: { node?: string }) => ((a.node || '') < (b.node || '') ? -1 : 1);
			const complete = !diagnostics.length && packages.length === Object.keys(graph?.nodes || {}).length;
			return {
				protocol: 'beyond-sources/1',
				graph: graph?.digest,
				complete,
				packages: packages.sort(order),
				diagnostics: diagnostics.sort(order)
			};
		};

		if (graph?.protocol !== 'beyond-graph/1' || !graph.nodes || typeof graph.nodes !== 'object') {
			return report([], [{ code: 'GRAPH_INVALID', message: 'A beyond-graph/1 document is required' }]);
		}
		if ((graph.diagnostics || []).some(({ severity }) => severity === 'error')) {
			const message = 'The graph has errors: only a graph that was completely pinned is fetched';
			return report([], [{ code: 'GRAPH_INVALID', message }]);
		}
		if (!store || typeof store.has !== 'function' || typeof store.commit !== 'function') {
			throw new Error('A store is required');
		}

		const bounds = new Limits(limits);
		const download = new Download(store, bounds, authorizer, tenant, transport);
		const queue = new Queue(bounds.concurrency);
		const excepted = new Set((graph.exceptions || []).map(({ node }) => node));

		const packages: ISourceResult[] = [];
		const diagnostics: ISourceDiagnostic[] = [];
		const tasks = Object.keys(graph.nodes).map(key =>
			queue.run(async () => {
				const { result, diagnostic } = await download.run(key, graph.nodes[key], excepted.has(key));
				result ? packages.push(result) : diagnostics.push(diagnostic);
			})
		);
		await Promise.all(tasks);

		return report(packages, diagnostics);
	}
}
