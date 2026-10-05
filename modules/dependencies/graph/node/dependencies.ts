import type { IDependencySpec } from '@beyond-js/packages/dependencies/spec';
import type { Node as DependencyNode } from '.';

/**
 * The dependencies of one occurrence, by declared name (the importers of a workspace, by node key)
 */
export /*bundle*/ class NodeDependencies extends Map<string, DependencyNode> {
	#node: DependencyNode;

	#processing = false;
	get processing() {
		return this.#processing;
	}

	#processed = false;
	get processed() {
		return this.#processed;
	}

	/**
	 * True when every occurrence below was processed, all the way down. It says nothing about errors: a
	 * failed occurrence is processed too. See `Closure` for validity.
	 */
	get settled(): boolean {
		// An occurrence that failed, a peer requirement and a release without metadata expand nothing:
		// what matters is that nothing is left being processed or waiting to be
		if (this.#processing) return false;
		for (const dependency of this.values()) {
			if (dependency.processing || !dependency.processed) return false;
			if (!dependency.dependencies.settled) return false;
		}
		return true;
	}

	/**
	 * True when every occurrence below was processed and none failed, all the way down. A failure that is
	 * only reachable through an optional dependency is judged by `Closure`, not here.
	 */
	get completed(): boolean {
		if (!this.settled) return false;
		for (const dependency of this.values()) {
			if (dependency.error || !dependency.dependencies.completed) return false;
		}
		return true;
	}

	constructor(node: DependencyNode) {
		super();
		this.#node = node;
	}

	/**
	 * Forgets the occurrences below, unregistering them, so that the node can be processed again
	 */
	reset() {
		for (const node of [...this.values()]) {
			node.dependencies.reset();
			this.#node.registry.nodes.unregister(node);
		}
		this.clear();
		this.#processed = false;
	}

	invalidate() {
		this.reset();
	}

	/**
	 * Creates the occurrences of what a package declares, versions them and expands them
	 *
	 * @param spec The declarations, by declared name; an entry keyed otherwise names its package
	 */
	async process(spec: Map<string, IDependencySpec>, update: boolean) {
		if (this.#processing || this.#processed) {
			throw new Error('Dependencies are already processed or they are being processed');
		}
		this.#processing = true;

		try {
			/**
			 * Node has to be dynamically required to avoid a cyclical import
			 */
			const m = require('./');
			const Node: typeof DependencyNode = m.Node;

			const parent = this.#node;
			const { policy } = parent.registry;
			const root = !parent.parent;
			// The top installs its own dependencies: the root, and each importer of a workspace
			const top = root || parent.importer;
			// The importers of a workspace are what its root declares: no override replaces them
			const importers = root && !!parent.project.members;

			// An occurrence linked to the one that expands its release only evaluates its own peers:
			// they depend on where the occurrence is, the rest of the release is expanded once
			const declarations: [string, IDependencySpec][] = [];
			for (const key of [...spec.keys()].sort()) {
				const declaration = policy ? policy.declaration(spec.get(key), top) : spec.get(key);
				if (!declaration || (parent.link && (declaration.kind !== 'peer' || root))) continue;
				declarations.push([key, declaration]);
			}

			// Every occurrence is created and versioned before any is expanded: siblings are what
			// provides the peers of each other
			for (const [key, { kind, version: declared, optional }] of declarations) {
				const name = spec.get(key).package || key;
				const version = policy && !importers ? policy.overrides.apply(name, declared, parent.path) : declared;

				const dependency = { kind, package: name, key, version, declared, optional };
				const { project, registry, logger } = parent;
				const node = new Node({ project, registry, logger, dependency, parent });
				this.set(key, node);
			}

			for (const node of this.values()) await node.register(update);
			for (const node of this.values()) await node.process({ update });

			this.#processed = true;
		} finally {
			this.#processing = false;
		}
	}

	async reprocess(update: boolean) {
		if (!this.#processed) {
			throw new Error('Dependencies must be previously processed to be able to reprocess them');
		}
		if (this.#processing) {
			throw new Error('Dependencies are already being processed');
		}

		this.#processing = true;
		try {
			for (const node of [...this.values()]) await node.reprocess(update);
		} finally {
			this.#processing = false;
		}
	}
}
