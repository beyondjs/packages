import type { DependencyPackage } from '../..';
import type { Node } from '../../../../node';
import { DependencyIsType } from '@beyond-js/packages/providers/parser';

export class FixedNodes extends Map<string, Array<Node>> {
	#package: DependencyPackage;

	constructor(pkg: DependencyPackage) {
		super();
		this.#package = pkg;
	}

	async register(node: Node) {
		let key: string;
		if (node.data.is === DependencyIsType.Git) {
			// Get the commit version
			const { ref } = node.data;
			const key = ''; // node.data.key;

			const { project } = this.#package;
			const commit = 'the commit'; // await project.packages.commit(this.#package.name, ref);

			if (!this.has(key)) this.set(key, []);
			this.get(key)!.push(node);

			throw new Error('Not implemented');
		} else if (node.data.is === DependencyIsType.Url) {
			throw new Error('Not implemented');
		} else if (node.data.is === DependencyIsType.Alias) {
			throw new Error('Not implemented');
		}
	}

	unregister(node: Node) {
		let key: string;
		if (node.data.is === DependencyIsType.Git) {
			const key = ''; // node.data.key;
		} else if (node.data.is === DependencyIsType.Url) {
			throw new Error('Not implemented');
		} else if (node.data.is === DependencyIsType.Alias) {
			throw new Error('Not implemented');
		}

		const nodes = this.get(key);
		if (!nodes) throw new Error(`No nodes found for key: ${key}`);

		// Find and remove the node from the array
		const index = nodes.indexOf(node);
		if (index === -1) throw new Error('Node not found in the list for the given key');
		nodes.splice(index, 1);

		// If the array is empty after removal, delete the key from the map
		!nodes.length && this.delete(key);
	}
}
