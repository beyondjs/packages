import type { IProject } from '@beyond-js/packages/project/types';
import type { Registry } from '../';
import type { Node } from '../../node';
import { DependencyPackage } from '../package';

/**
 * Every dependency occurrence of the graph, by occurrence id. Two occurrences of one package are two
 * entries: registering and unregistering use the same key, so neither can overwrite or orphan the other.
 */
export class Nodes {
	#project: IProject;
	#registry: Registry;
	#nodes: Map<string, Node>;

	get size() {
		return this.#nodes.size;
	}

	constructor(project: IProject, registry: Registry) {
		this.#project = project;
		this.#registry = registry;
		this.#nodes = new Map();
	}

	has(node: Node) {
		return this.#nodes.get(node.id) === node;
	}

	values() {
		return this.#nodes.values();
	}

	clear() {
		this.#nodes.clear();
	}

	async register(node: Node, update: boolean) {
		if (this.#nodes.has(node.id)) throw new Error(`Dependency occurrence "${node.id}" is already registered`);
		this.#nodes.set(node.id, node);

		const { source } = node;
		const dependency = (() => {
			if (this.#registry.packages.has(source.id)) return this.#registry.packages.get(source.id);

			const dependency = new DependencyPackage(this.#project, source, this.#registry);
			this.#registry.packages.set(source.id, dependency);
			return dependency;
		})();

		await dependency.nodes.register(node, update);
	}

	/**
	 * Removes an occurrence. Removing one that is not registered is not an error: a failed registration
	 * and a repeated cleanup must both leave the registry consistent.
	 */
	unregister(node: Node) {
		if (!this.has(node)) return;
		this.#nodes.delete(node.id);

		const { source } = node;
		const dependency = this.#registry.packages.get(source.id);
		if (!dependency) return;
		dependency.nodes.unregister(node);

		// If the package has no more nodes, remove it from the registry
		if (!dependency.nodes.semver.size && !dependency.nodes.fixed.size) {
			this.#registry.packages.delete(source.id);
		}
	}
}
