// The type a manifest group declares, by the kind of the graph's edge
const TYPES = Object.freeze({ dependency: 'prod', build: 'dev', peer: 'peer', optional: 'optional' });

/**
 * A graph of the workspace indexed for dependency management: a `beyond-lock/2` document, a
 * `beyond-workspace-graph/1` one or the inventory's own, with its nodes by key and the edges of each node in both
 * directions. Closures visit each node once, so a shared or cyclic node appears once whatever the number of paths
 * that reach it.
 *
 * ```js
 * const graph = new Graph(lock);
 * graph.closure('workspace:apps/web', 'out');   // every node the member reaches
 * graph.page('apps/web');                       // what a page of that importer loads
 * ```
 */
export class Graph {
	#nodes = new Map();
	#members = {};
	#out = new Map();
	#in = new Map();
	#names = new Map();

	/**
	 * @param {{nodes?: object, edges?: object[], members?: object}} [document]
	 */
	constructor({ nodes = {}, edges = [], members = {} } = {}) {
		for (const [key, node] of Object.entries(nodes ?? {})) this.add(key, node);
		this.#members = { ...(members ?? {}) };
		for (const edge of edges ?? []) this.link(edge);
	}

	/**
	 * The type a manifest group declares for an edge kind: `prod`, `dev`, `peer` or `optional`
	 */
	static type(kind) {
		return TYPES[kind] ?? 'prod';
	}

	get nodes() {
		return this.#nodes;
	}

	/**
	 * The importers by id: `{name, version, node}`
	 */
	get members() {
		return this.#members;
	}

	add(key, node) {
		this.#nodes.set(key, node);
		const name = node?.name;
		if (typeof name !== 'string') return;
		this.#names.has(name) ? this.#names.get(name).add(key) : this.#names.set(name, new Set([key]));
	}

	/**
	 * Adds an edge; one whose target is null (a skipped optional dependency) is kept on its source only
	 */
	link(edge) {
		if (!edge || typeof edge.from !== 'string') return;
		this.#out.has(edge.from) ? this.#out.get(edge.from).push(edge) : this.#out.set(edge.from, [edge]);
		if (typeof edge.to !== 'string') return;
		this.#in.has(edge.to) ? this.#in.get(edge.to).push(edge) : this.#in.set(edge.to, [edge]);
	}

	node(key) {
		return this.#nodes.get(key);
	}

	has(key) {
		return this.#nodes.has(key);
	}

	/**
	 * The edges that leave a node
	 */
	out(key) {
		return this.#out.get(key) ?? [];
	}

	/**
	 * The edges that reach a node
	 */
	in(key) {
		return this.#in.get(key) ?? [];
	}

	/**
	 * The keys of the nodes of a name
	 */
	keys(name) {
		return [...(this.#names.get(name) ?? [])];
	}

	/**
	 * The name an edge declares: its own when it is an alias or was skipped, else its target's
	 */
	named(edge) {
		return edge.name ?? this.#nodes.get(edge.to)?.name;
	}

	/**
	 * Every node reached from a start in one direction, the start included, each once
	 *
	 * @param {string} start
	 * @param {'out' | 'in'} direction `out` follows dependencies, `in` follows dependents
	 * @param {number} [limit] Nodes visited at most
	 */
	closure(start, direction, limit = Infinity) {
		const seen = new Set([start]);
		const queue = [start];
		while (queue.length && seen.size < limit) {
			const key = queue.shift();
			const edges = direction === 'out' ? this.out(key) : this.in(key);
			for (const edge of edges) {
				const next = direction === 'out' ? edge.to : edge.from;
				if (typeof next !== 'string' || seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		return seen;
	}

	/**
	 * What one page of an importer loads: the nodes its runtime dependencies reach, without development (build) edges,
	 * a peer followed only in the context of a node of that page
	 *
	 * @param {string} id The importer's id
	 * @returns {Set<string>}
	 */
	page(id) {
		const start = this.#members[id]?.node ?? `workspace:${id}`;
		const seen = new Set([start]);
		const queue = [start];
		while (queue.length) {
			const key = queue.shift();
			for (const edge of this.out(key)) {
				const { to, kind, context } = edge;
				if (typeof to !== 'string' || seen.has(to) || kind === 'build') continue;
				if (kind === 'peer' && context !== undefined && !seen.has(context)) continue;
				seen.add(to);
				queue.push(to);
			}
		}
		return seen;
	}
}
