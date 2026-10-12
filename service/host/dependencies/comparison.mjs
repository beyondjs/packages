/**
 * What a plan changes in the graph of the workspace: the current graph (the lock) against the proposed one (the
 * resolution of the plan), through the edges of each dependent.
 *
 * - **changed**: a dependent's edge to a name reaches another node now: `{name, from: {key, version}, to: {key,
 *   version}, reason, dependents}`, one entry per pair of nodes, with every dependent that moved;
 * - **added** and **removed**: nodes only one graph holds and that no change already names;
 * - **preserved**: the external nodes both graphs hold, with the same key (name, version and source);
 * - **integrity**: nodes both graphs hold whose integrity differs, which no registry may do to a published release.
 *
 * Members are on disk in both graphs and are never counted here. The reason of each change is `requested` (the plan
 * names the package), `peer` (released because it requires a requested package as a peer) or `transitive`.
 */
export class Comparison {
	#current;
	#proposed;
	#requested;
	#peers;
	#changed = [];
	#added = [];
	#removed = [];
	#preserved = 0;
	#integrity = [];

	/**
	 * @param {import('./graph.mjs').Graph} current
	 * @param {import('./graph.mjs').Graph} proposed
	 * @param {{requested: string[], peers?: string[]}} reasons
	 */
	constructor(current, proposed, { requested, peers = [] }) {
		this.#current = current;
		this.#proposed = proposed;
		this.#requested = new Set(requested);
		this.#peers = new Set(peers);
		this.#compare();
	}

	static #external(key) {
		return typeof key === 'string' && !key.startsWith('workspace:');
	}

	#reason(name) {
		if (this.#requested.has(name)) return 'requested';
		return this.#peers.has(name) ? 'peer' : 'transitive';
	}

	#described(graph, key) {
		return { key, version: graph.node(key)?.version ?? null };
	}

	#compare() {
		const [current, proposed] = [this.#current, this.#proposed];
		const identity = (graph, edge) => `${edge.from}\u0000${graph.named(edge)}\u0000${edge.kind}\u0000${edge.context ?? ''}`;
		const before = new Map();
		for (const key of current.nodes.keys()) for (const edge of current.out(key)) before.set(identity(current, edge), edge);

		const pairs = new Map();
		for (const key of proposed.nodes.keys()) {
			for (const edge of proposed.out(key)) {
				const previous = before.get(identity(proposed, edge));
				if (!previous || previous.to === edge.to || !Comparison.#external(previous.to) || !Comparison.#external(edge.to)) continue;
				const id = `${previous.to}\u0000${edge.to}`;
				const pair = pairs.get(id) ?? { name: proposed.named(edge), from: this.#described(current, previous.to), to: this.#described(proposed, edge.to), dependents: new Set() };
				pair.dependents.add(edge.from);
				pairs.set(id, pair);
			}
		}
		this.#changed = [...pairs.values()]
			.map(pair => ({ ...pair, reason: this.#reason(pair.name), dependents: [...pair.dependents].sort() }))
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.to.key < b.to.key ? -1 : 1));

		const targets = new Set(this.#changed.map(({ to }) => to.key));
		const sources = new Set(this.#changed.map(({ from }) => from.key));
		for (const [key, node] of proposed.nodes) {
			if (!Comparison.#external(key)) continue;
			if (current.has(key)) {
				this.#preserved++;
				const was = current.node(key);
				was.integrity && node.integrity && was.integrity !== node.integrity && this.#integrity.push({ key, before: was.integrity, after: node.integrity });
				continue;
			}
			!targets.has(key) && this.#added.push({ key, name: node.name, version: node.version, reason: this.#reason(node.name) });
		}
		for (const [key, node] of current.nodes) {
			if (!Comparison.#external(key) || proposed.has(key) || sources.has(key)) continue;
			this.#removed.push({ key, name: node.name, version: node.version, reason: this.#reason(node.name) });
		}
	}

	get changed() {
		return this.#changed;
	}

	get added() {
		return this.#added;
	}

	get removed() {
		return this.#removed;
	}

	get preserved() {
		return { count: this.#preserved };
	}

	get integrity() {
		return this.#integrity;
	}

	/**
	 * Every external node the plan changes, adds or removes, in either graph
	 */
	get keys() {
		const keys = new Set();
		this.#changed.forEach(({ from, to }) => keys.add(from.key).add(to.key));
		[...this.#added, ...this.#removed].forEach(({ key }) => keys.add(key));
		return keys;
	}
}
