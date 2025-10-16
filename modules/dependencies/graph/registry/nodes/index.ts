import type { IProject } from '@beyond-js/packages/project/types';
import type { Registry } from '../';
import type { Node } from '../../node';
import { DependencyPackage } from '../package';

export class Nodes {
	#project: IProject;
	#registry: Registry;
	#nodes: Map<string, Node>;

	constructor(project: IProject, registry: Registry) {
		this.#project = project;
		this.#registry = registry;
		this.#nodes = new Map();
	}

	async register(node: Node, update: boolean) {
		this.#nodes.set(node.package, node);

		const { source } = node;
		const dependency = (() => {
			if (this.#registry.packages.has(source.id)) return this.#registry.packages.get(source.id);

			const dependency = new DependencyPackage(this.#project, source);
			this.#registry.packages.set(source.id, dependency);
			return dependency;
		})();

		await dependency.nodes.register(node, update);
	}

	unregister(node: Node) {
		const { source } = node;
		if (!this.#nodes.has(source.id)) throw new Error(`Node package with id "${source.id}" not found on registry`);
		this.#nodes.delete(source.id);

		const dependency = this.#registry.packages.get(source.id);
		dependency.nodes.unregister(node);

		// If the package has no more nodes, remove it from the registry
		if (!dependency.nodes.semver.groups.length && !dependency.nodes.fixed.size) {
			this.#registry.packages.delete(source.id);
		}
	}
}
