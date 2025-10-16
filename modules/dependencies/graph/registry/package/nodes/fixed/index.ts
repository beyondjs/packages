import type { DependencyPackage } from '../..';
import type { Node } from '../../../../node';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';

export class FixedNodes extends Map<string, Array<Node>> {
	#package: DependencyPackage;

	constructor(pkg: DependencyPackage) {
		super();
		this.#package = pkg;
	}

	async register(node: Node, update: boolean) {
		if (node.source.data.is === DependencySourceIsType.Git) {
			// Get the commit version
			const { ref } = node.source.data;
			const { project } = this.#package;
			const commit = 'the commit'; // await project.packages.commit(this.#package.name, ref);

			node.version.update({ version: commit });

			if (!this.has(commit)) this.set(commit, []);
			this.get(commit)!.push(node);

			throw new Error('Not implemented');
		} else if (node.source.data.is === DependencySourceIsType.Url) {
			throw new Error('Not implemented');
		} else if (node.source.data.is === DependencySourceIsType.Alias) {
			throw new Error('Not implemented');
		}
	}

	unregister(node: Node) {
		let key: string;
		if (node.source.data.is === DependencySourceIsType.Git) {
			const key = ''; // node.source.data.key;
		} else if (node.source.data.is === DependencySourceIsType.Url) {
			throw new Error('Not implemented');
		} else if (node.source.data.is === DependencySourceIsType.Alias) {
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
