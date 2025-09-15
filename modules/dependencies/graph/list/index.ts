import type { Registries } from '@beyond-js/packages/repositories/registries';
import type { DependenciesNode } from '../node';
import { DependencyPackage } from './package';

export class DependenciesList extends Map<string, DependencyPackage> {
	#registries: Registries;

	constructor(registries: Registries) {
		super();
		this.#registries = registries;
	}

	async register(node: DependenciesNode) {
		const { pkg } = node;

		const dependency = this.has(pkg) ? this.get(pkg) : new DependencyPackage(this.#registries, pkg);
		!dependency.initialized && (await dependency.initialize());

		const consumer = dependency.register(node);
		this.set(pkg, dependency);
		return consumer;
	}

	unregister(node: DependenciesNode) {
		const dependency = this.get(node.pkg);
		dependency.unregister(node);
		!dependency.groups.length && this.delete(node.pkg);
	}
}
