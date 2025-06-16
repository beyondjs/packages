import type { DependenciesNode } from '../node';
import { PackageDependency } from './package-dependency';

export class DependenciesList extends Map<string, PackageDependency> {
	async register(node: DependenciesNode) {
		const { pkg } = node;

		const dependency = this.has(pkg) ? this.get(pkg) : new PackageDependency(pkg);
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
