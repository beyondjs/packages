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
		const dependency = this.#registry.packages.has(pkg)
			? this.#registry.packages.get(pkg)
			: new DependencyPackage(this.#project, pkg);

		// Ensure the package is initialized (versions are fetched)
		await dependency.ready;

		const consumer = dependency.nodes.register(node);
		this.#registry.packages.set(pkg, dependency);
		return consumer;
	}

	unregister(node: Node) {
		if (!this.#nodes.has(node.package)) throw new Error(`The node "${node.package}" is not registered`);
		this.#nodes.delete(node.package);

		const dependency = this.#registry.packages.get(node.package);
		dependency.nodes.unregister(node);
		!dependency.nodes.groups.length && this.#registry.packages.delete(node.package);
	}

	recalculate() {
		// Build matrix of versions
		this.#nodes.forEach(node => {});
	}
}
