/**
 * Reads a lock (`beyond-lock/2`), a workspace graph or a pinned graph by package name and member id instead of by
 * node key, because external keys carry the identity of the fixture registry, whose port changes with every run.
 */
export class Graph {
	#document;

	/**
	 * The document read
	 */
	get document() {
		return this.#document;
	}

	/**
	 * @param {object} document A lock, a workspace graph or a pinned graph
	 */
	constructor(document) {
		this.#document = document;
	}

	/**
	 * The key of a member's node
	 */
	static member(id) {
		return `workspace:${id}`;
	}

	/**
	 * Whether a node belongs to the workspace rather than to a provider
	 */
	local(key) {
		return this.#document.nodes[key]?.origin?.provider === 'workspace';
	}

	/**
	 * The keys of the nodes of a provider, sorted
	 */
	get external() {
		return Object.keys(this.#document.nodes)
			.filter(key => !this.local(key))
			.sort();
	}

	/**
	 * `name@version` of every external node, sorted
	 */
	get releases() {
		return this.external.map(key => `${this.#document.nodes[key].name}@${this.#document.nodes[key].version}`).sort();
	}

	/**
	 * The keys of the nodes of a name, sorted
	 */
	keys(name) {
		return Object.keys(this.#document.nodes)
			.filter(key => this.#document.nodes[key].name === name)
			.sort();
	}

	/**
	 * The versions of the nodes of a name, sorted
	 */
	versions(name) {
		return this.keys(name)
			.map(key => this.#document.nodes[key].version)
			.sort();
	}

	/**
	 * The key of the one node of a name and version; it fails when there is not exactly one
	 */
	key(name, version) {
		const keys = this.keys(name).filter(key => this.#document.nodes[key].version === version);
		if (keys.length !== 1) throw new Error(`Expected one node of ${name}@${version}, found ${JSON.stringify(keys)}`);
		return keys[0];
	}

	/**
	 * The name an edge declares: its alias, or the name of the node it reaches
	 */
	declared(edge) {
		return edge.name ?? this.#document.nodes[edge.to]?.name;
	}

	/**
	 * The edges of a node that declare a name
	 */
	edges(from, name) {
		return this.#document.edges.filter(edge => edge.from === from && (!name || this.declared(edge) === name));
	}

	/**
	 * The one edge of a node for a name in a context; without a context, the edge that has none
	 */
	edge(from, name, context) {
		const found = this.edges(from, name).filter(edge => edge.context === context);
		if (found.length !== 1) throw new Error(`Expected one edge ${from} -> ${name} (${context}), found ${JSON.stringify(found)}`);
		return found[0];
	}

	/**
	 * The `name@version` an edge reaches
	 */
	target(edge) {
		const node = this.#document.nodes[edge.to];
		return node && `${node.name}@${node.version}`;
	}
}
