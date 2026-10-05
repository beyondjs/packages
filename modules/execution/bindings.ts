import type { IExecutionEdge, IExecutionResolution } from './types';
import type { Graph } from './graph';

/**
 * The edges of each importer, by the name it imports (the declared alias for an alias edge): how an import
 * of one node reaches another. It never guesses by name: an import the importer's edges do not provide is
 * refused, and a peer bound to different releases in different contexts needs the context that decides.
 */
export class Bindings {
	#graph: Graph;
	#edges: Map<string, Map<string, IExecutionEdge[]>> = new Map();
	#importers: Map<string, IExecutionEdge[]> = new Map();

	constructor(graph: Graph, edges: IExecutionEdge[]) {
		this.#graph = graph;
		for (const data of edges) {
			const edge = Object.freeze({ ...data });
			const all = this.#importers.get(edge.from) || [];
			all.push(edge);
			this.#importers.set(edge.from, all);

			const name = edge.name ?? (edge.to === null ? void 0 : graph.node(edge.to).name);
			if (!name) continue;
			const names = this.#edges.get(edge.from) || new Map<string, IExecutionEdge[]>();
			const list = names.get(name) || [];
			list.push(edge);
			names.set(name, list);
			this.#edges.set(edge.from, names);
		}
	}

	/**
	 * The edges of one node, in the order the projection records them
	 */
	of(from: string): IExecutionEdge[] {
		return [...(this.#importers.get(from) || [])];
	}

	resolve(from: string, name: string, context?: string): IExecutionResolution {
		const importer = this.#graph.node(from);
		if (!importer) {
			const message = `${from} is not a node of the installed graph: run beyond install`;
			return {
				error: { code: 'DEPENDENCY_NOT_INSTALLED', message, severity: 'error', node: from, details: { name } }
			};
		}
		// A package imports itself by its own name
		if (importer.name === name) return { key: from, node: importer };

		const edges = this.#edges.get(from)?.get(name) || [];
		const reached = edges.filter(({ to }) => to !== null);
		if (!reached.length) {
			const skipped = edges.find(({ skipped }) => skipped)?.skipped;
			const reason = skipped ? ` (the optional dependency was skipped: ${skipped})` : '';
			const message = `${from} imports ${name}, which its graph does not provide${reason}: declare it and run beyond install`;
			return {
				error: { code: 'DEPENDENCY_NOT_INSTALLED', message, severity: 'error', node: from, details: { name } }
			};
		}

		// The edge of the context wins, then the edge without a context, then a single target
		const single = (list: IExecutionEdge[]) => {
			const targets = new Set(list.map(({ to }) => to));
			return targets.size === 1 ? [...targets][0] : void 0;
		};
		const key =
			(context !== void 0 && single(reached.filter(edge => edge.context === context))) ||
			single(reached.filter(edge => !edge.context)) ||
			single(reached);
		if (key) return { key, node: this.#graph.node(key) };

		const candidates = reached.map(({ to, context }) => ({ to, context }));
		const bindings = candidates.map(({ to, context }) => `${to} in the context of ${context ?? 'its importer'}`);
		const within = context === void 0 ? 'no context was given' : `the context ${context} binds none of them`;
		const message = `${from} imports ${name}, which its graph binds to ${bindings.join(' and to ')}; ${within}`;
		const details = { name, context, candidates };
		return { error: { code: 'PEER_CONTEXT_AMBIGUOUS', message, severity: 'error', node: from, details } };
	}
}
