import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IGraph, IGraphNode } from './types';
import { Compatibility } from './compatibility';

/**
 * A pinned package graph, read as input data.
 *
 * Analysis and generation never select versions: they follow the edges a resolution already froze. Nodes
 * are keyed `origin:name@version`. The reader accepts the nodes as a record or as a list whose items carry
 * their `key`, and the edges as a top-level list of `{from, to}` or as a `dependencies` record
 * (`name → key`) on each node. A peer edge carries the `context` it was resolved in, and is followed from
 * the package that reached the dependent.
 */
export /*bundle*/ class Graph {
	#nodes: Map<string, IGraphNode> = new Map();
	#edges: Map<string, Map<string, { to: string; context?: string }[]>> = new Map();

	#diagnostics: IDiagnostic[] = [];
	get diagnostics() {
		return this.#diagnostics;
	}

	#digest?: string;

	/**
	 * The digest the graph carries, or the one of its canonical form when it carries none
	 */
	get digest() {
		return this.#digest;
	}

	get keys(): string[] {
		return [...this.#nodes.keys()].sort();
	}

	constructor(data: IGraph) {
		if (data?.protocol !== 'beyond-graph/1') {
			const message = `The graph declares the protocol "${data?.protocol}"; analysis reads "beyond-graph/1"`;
			this.#diagnostics.push({ code: 'GRAPH_PROTOCOL_UNKNOWN', message });
			return;
		}
		const { digest, ...document } = data;
		this.#digest = /^sha256-[0-9a-f]{64}$/.test(digest ?? '') ? digest : Compatibility.digest(document);

		const listed = data.nodes instanceof Array ? data.nodes.map(node => <[string, IGraphNode]>[node.key, node]) : Object.entries(data.nodes ?? {});
		listed.forEach(([key, node]) => {
			if (!key || typeof node?.name !== 'string' || typeof node?.version !== 'string') {
				this.#diagnostics.push({ code: 'GRAPH_NODE_INVALID', message: `Graph node "${key}" requires a key, a name and a version` });
				return;
			}
			this.#nodes.set(key, node);
			Object.entries(node.dependencies ?? {}).forEach(([name, to]) => this.#edge(key, to, name));
		});
		// An optional dependency that was skipped has no target, and nothing can import it
		(data.edges ?? []).forEach(({ from, to, name, context }) => to !== null && this.#edge(from, to, name, context));
	}

	#edge(from: string, to: string, name?: string, context?: string) {
		const target = this.#nodes.get(to);
		if (!this.#nodes.has(from) || !target) {
			this.#diagnostics.push({ code: 'GRAPH_EDGE_INVALID', message: `Graph edge "${from}" → "${to}" names a node that is not in the graph` });
			return;
		}
		!this.#edges.has(from) && this.#edges.set(from, new Map());
		// An alias is followed by the name the dependent imports, and lands on the node of the target
		const edges = this.#edges.get(from);
		const imported = name ?? target.name;
		edges.set(imported, (edges.get(imported) ?? []).concat({ to, context }));
	}

	node(key: string): IGraphNode | undefined {
		return this.#nodes.get(key);
	}

	/**
	 * The keys of the nodes of a package, optionally of one exact version
	 */
	find(name: string, version?: string): string[] {
		return this.keys.filter(key => {
			const node = this.#nodes.get(key);
			return node.name === name && (!version || node.version === version);
		});
	}

	/**
	 * Which node satisfies a package name imported from a node. A package always satisfies itself. Without
	 * an edge, the only node of that name in the graph is accepted with a warning, which is how a provided
	 * peer appears in a graph that does not repeat it as an edge; several candidates are never guessed.
	 */
	resolve(from: string, name: string, context?: string): { key?: string; warning?: IDiagnostic; error?: IDiagnostic } {
		if (this.#nodes.get(from)?.name === name) return { key: from };

		// A peer is bound per context: the edge of the context that reached the package wins
		const edges = this.#edges.get(from)?.get(name) ?? [];
		const bound = edges.find(edge => context && edge.context === context) ?? edges[0];
		if (bound && (edges.every(edge => edge.to === bound.to) || bound.context === context)) return { key: bound.to };
		if (bound) {
			const message = `"${from}" binds its peer "${name}" differently per context (${edges.map(edge => edge.to).join(', ')}) and was not reached from one of them`;
			return { error: { code: 'PEER_CONTEXT_AMBIGUOUS', message } };
		}

		const candidates = this.find(name);
		if (candidates.length === 1) {
			const message = `"${from}" imports "${name}" without an edge in the graph; its only node "${candidates[0]}" is used`;
			return { key: candidates[0], warning: { code: 'DEPENDENCY_EDGE_MISSING', message } };
		}

		const message = candidates.length
			? `"${from}" imports "${name}", which the graph pins ${candidates.length} times without an edge from it (${candidates.join(', ')})`
			: `"${from}" imports "${name}", which is not in the pinned graph. Declare the dependency and resolve the graph again`;
		return { error: { code: 'DEPENDENCY_UNRESOLVED', message } };
	}
}
