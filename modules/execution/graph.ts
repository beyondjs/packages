import type { IExecutionDocument, IExecutionMember, IExecutionNode } from './types';
import { resolve } from 'path';

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The nodes and members of a projection, indexed by key, by name and by location. Every node it answers is
 * frozen: what a consumer reads cannot change what another one finds.
 */
export class Graph {
	#nodes: Map<string, IExecutionNode> = new Map();
	#names: Map<string, string[]> = new Map();
	#locations: Map<string, string> = new Map();
	#members: Map<string, IExecutionMember> = new Map();

	get nodes(): ReadonlyMap<string, IExecutionNode> {
		return this.#nodes;
	}

	get members(): ReadonlyMap<string, IExecutionMember> {
		return this.#members;
	}

	constructor(document: IExecutionDocument) {
		for (const key of Object.keys(document.nodes).sort(order)) {
			const data = document.nodes[key];
			const origin = data.origin && Object.freeze({ ...data.origin });
			const location = resolve(data.location);
			const node: IExecutionNode = Object.freeze({ ...data, ...(origin ? { origin } : {}), key, location });
			this.#nodes.set(key, node);

			const keys = this.#names.get(node.name) || [];
			keys.push(key);
			this.#names.set(node.name, keys);
			this.#locations.set(location, key);
		}

		for (const id of Object.keys(document.members).sort(order)) {
			const { name, version, node, location } = document.members[id];
			this.#members.set(id, Object.freeze({ id, name, version, node, location: resolve(location) }));
		}
	}

	node(key: string): IExecutionNode | undefined {
		return this.#nodes.get(key);
	}

	find(name: string, version?: string): string[] {
		const keys = this.#names.get(name) || [];
		return version === void 0 ? [...keys] : keys.filter(key => this.#nodes.get(key).version === version);
	}

	instance(path: string): string | undefined {
		return typeof path === 'string' && path ? this.#locations.get(resolve(path)) : void 0;
	}
}
