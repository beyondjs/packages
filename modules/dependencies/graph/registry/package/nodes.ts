import type { Node } from '../../node';
import type { DependencyPackage } from './';
import { Groups } from './groups';

export class PackageNodes {
	#package: DependencyPackage;

	#groups: Groups;
	get groups() {
		return this.#groups;
	}

	constructor(pkg: DependencyPackage, versions: string[]) {
		this.#package = pkg;
		this.#groups = new Groups(versions);
	}

	register(node: Node) {
		if (this.#package.error) throw new Error('Dependency package is invalid. Check the .error property');
		this.#groups.register(node);
	}

	unregister(node: Node) {
		this.#groups.unregister(node);
	}
}
