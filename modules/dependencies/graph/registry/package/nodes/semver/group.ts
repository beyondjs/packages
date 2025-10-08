import type { Node } from '../../../../node';
import { intersects, maxSatisfying } from 'semver';

export class Group extends Array<Node> {
	#versions: string[];

	// Optional: current chosen version for ideal placement (if you decide)
	#chosen: string;
	get chosen() {
		return this.#chosen;
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

		const chosen = maxSatisfying(this.#versions, items)!;

		// If chosen version hasn't changed, just return
		if (this.#chosen === chosen) return;

		this.#chosen = chosen;

		// Update the new chosen version to all the nodes in the group
		this.forEach(node => node.version.resolved !== chosen && node.version.update({ version: chosen }));
	}

	register(node: Node) {
		const { specified } = node.version;
		if (!this.intersects(specified)) {
			throw new Error(`Version "${specified}" doesn't intersect with current group`);
		}

		this.push(node);
		node.version.update({ version: this.#chosen });
		this.#updateMax();
	}

	unregister(node: Node) {
		this.splice(this.indexOf(node), 1);
		this.length && this.#updateMax();
	}
}
