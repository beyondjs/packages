import type { Providers } from '@beyond-js/packages/providers';
import { DependencyPackage } from './package';
import { Nodes } from './nodes';

export class Registry {
	#packages: Map<string, DependencyPackage>;
	get packages() {
		return this.#packages;
	}

	#nodes: Nodes;
	get nodes() {
		return this.#nodes;
	}

	constructor(providers: Providers) {
		this.#packages = new Map();
		this.#nodes = new Nodes(providers, this);
	}
}
