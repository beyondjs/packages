import type { DependenciesSpec } from '@beyond-js/packages/dependencies/spec';
import type { Node as DependencyNode } from '.';

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

	get completed(): boolean {
		for (const dependency of [...this.values()]) {
			if (!dependency.processed) return false;
		}

		return true;
	}

	constructor(node: DependencyNode) {
		super();
		this.#node = node;
	}

	invalidate() {
		if (!this.#processed) return;
		this.#processed = false;

		this.forEach((node, pkg) => {
			this.#node.registry.nodes.unregister(node);
			node.invalidate();

			this.delete(pkg);
		});
	}

	async process(spec: DependenciesSpec) {
		if (this.#processing || this.#processed) {
			throw new Error('Dependencies are already processed or they are being processed');
		}
		this.#processing = true;

		/**
		 * Node has to be dynamically required to avoid a cyclical import
		 */
		const m = require('./');
		const Node: typeof DependencyNode = m.Node;

		for (const [name, { kind, version }] of spec) {
			const node = new Node({
				project: this.#node.project,
				registry: this.#node.registry,
				logger: this.#node.logger,
				dependency: { kind, package: name, version },
				parent: this.#node
			});
			await node.register();
			this.set(name, node);
		}

		for (const node of this.values()) {
			await node.process();
		}

		this.#processing = false;
		this.#processed = true;
	}

	async reprocess() {
		if (!this.#processed) {
			throw new Error('Dependencies must be previously processed to be able to reprocess them');
		}
		if (this.#processing) {
			throw new Error('Dependencies are already being processed');
		}

		this.#processing = true;
		for (const node of [...this.values()]) {
			await node.reprocess();
		}
		this.#processing = false;
	}
}
