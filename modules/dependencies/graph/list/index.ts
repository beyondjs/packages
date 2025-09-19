import type { Providers } from '@beyond-js/packages/providers';
import type { DependenciesNode } from '../node';
import { DependencyPackage } from './package';

export class DependenciesList extends Map<string, DependencyPackage> {
	#providers: Providers;

	constructor(providers: Providers) {
		super();
		this.#providers = providers;
	}

	async register(node: DependenciesNode) {
		const { pkg } = node;

		const dependency = this.has(pkg) ? this.get(pkg) : new DependencyPackage(this.#providers, node.info);
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
