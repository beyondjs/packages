import type { Node } from '../node';

/**
 * Which occurrence expands each release. A release (one version of one package) is expanded once, by the
 * first occurrence that reaches it; every other occurrence links to that one. This is the visited guard
 * of the graph: a cycle reaches a release that an ancestor already claimed, links to it and stops.
 */
export class Releases {
	#owners: Map<string, Node> = new Map();
	get owners() {
		return this.#owners;
	}

	/**
	 * @returns The occurrence that expands the release: the given one when it is the first to reach it
	 */
	claim(key: string, node: Node): Node {
		if (!this.#owners.has(key)) this.#owners.set(key, node);
		return this.#owners.get(key);
	}

	clear() {
		this.#owners.clear();
	}
}
