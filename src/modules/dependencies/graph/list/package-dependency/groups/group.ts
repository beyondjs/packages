import { ErrorManager } from '@beyond-js/response/main';
import type { DependenciesNode } from '../../../node';
import { intersects, maxSatisfying } from 'semver';

export class Group extends Array<DependenciesNode> {
	#versions: string[];

	#max: string;
	get max() {
		return this.#max;
	}

	constructor(versions: string[]) {
		super();
		this.#versions = versions;
	}

	intersects(version: string) {
		return this.reduce((valid, { version: { resolved } }) => valid && intersects(version, resolved), true);
	}

	/**
	 * Calculates the max version of the group and update the nodes of the group if it has changed
	 */
	#updateMax() {
		const items = this.map(node => node.version.specified).join(' ');

		// As the versions in the group are all satisfying versions, we can assure that max! is going to be defined
		const max = maxSatisfying(this.#versions, items)!;

		// If max version hasn't changed, just return
		if (this.#max === max) return;

		this.#max = max;

		// Update the new max version to all the nodes in the group
		this.forEach(node => node.version.resolved !== max && node.version.update({ version: max }));
	}

	register(node: DependenciesNode) {
		const { specified } = node.version;
		if (!this.intersects(specified)) {
			throw new Error(`Version "${specified}" doesn't intersect with current group`);
		}

		this.push(node);
		node.version.update({ version: this.#max });
		this.#updateMax();
	}

	unregister(node: DependenciesNode) {
		this.splice(this.indexOf(node), 1);
		this.length && this.#updateMax();
	}
}
