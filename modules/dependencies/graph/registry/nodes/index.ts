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

	async register(node: Node) {
		this.#nodes.set(node.package, node);

		const { package: pkg } = node;
		const dependency = (() => {
			if (this.#registry.packages.has(pkg)) return this.#registry.packages.get(pkg);

			const dependency = new DependencyPackage(pkg, this.#project);
			this.#registry.packages.set(pkg, dependency);
			return dependency;
		})();

		await dependency.nodes.register(node);
	}

	unregister(node: Node) {
		if (!this.#nodes.has(node.package)) throw new Error(`The node "${node.package}" is not registered`);
		this.#nodes.delete(node.package);

		const dependency = this.#registry.packages.get(node.package);
		dependency.nodes.unregister(node);

		// If the package has no more nodes, remove it from the registry
		if (!dependency.nodes.semver.groups.length && !dependency.nodes.fixed.size) {
			this.#registry.packages.delete(node.package);
		}
	}
}
