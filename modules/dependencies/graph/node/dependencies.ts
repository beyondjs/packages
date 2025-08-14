import type { Registries } from '@beyond-js/packages/repositories/registries';
import type { DependenciesSpecs } from '@beyond-js/packages/dependencies/specs';
import type { DependenciesList } from '../list';
import type { DependenciesNode } from '.';

export /*bundle*/ class NodeDependencies extends Map {
	#registries: Registries;
	#node: DependenciesNode;
	#list: DependenciesList;

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
			if (!dependency.completed) return false;
		}

		return true;
	}

	constructor(node: DependenciesNode, list: DependenciesList) {
		super();

		this.#node = node;
		this.#list = list;
	}

	invalidate() {
		if (!this.#processed) return;
		this.#processed = false;

		this.forEach((node, pkg) => {
			this.#list.unregister(node);
			node.invalidate();

			this.delete(pkg);
		});
	}

	async process(specs: DependenciesSpecs) {
		if (this.#processing || this.#processed) {
			throw new Error('Dependencies are already processed or they are being processed');
		}
		this.#processing = true;

		/**
		 * Node has to be dynamically required to avoid a cyclical import
		 */
		const { DependenciesNode: Node } = await import('./');

		for (const [name, { version }] of specs) {
			const node = new Node(this.#registries, this.#list, name, version, this.#node);
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
