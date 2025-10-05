import type { IProject } from '@beyond-js/packages/project/types';
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

	constructor(project: IProject) {
		this.#packages = new Map();
		this.#nodes = new Nodes(project, this);
	}
}
