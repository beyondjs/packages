import type { Node } from '../../../../node';
import { satisfies, rcompare } from 'semver';

/**
 * Picks versions of one package out of those published: the ones that satisfy every range of a set, and
 * the preferred one among them (a pinned release first, the highest otherwise).
 */
export class Candidates {
	#versions: string[];
	#pinned: Set<string>;

	constructor(versions: string[], pinned: string[]) {
		this.#versions = [...versions].sort(rcompare);
		this.#pinned = new Set(pinned);
	}

	/**
	 * Versions in the intersection of the ranges, highest first. Each range is tested on its own, which
	 * is what makes an alternative (`^1 || ^2`) intersect correctly with another range.
	 */
	of(ranges: string[]): string[] {
		return this.#versions.filter(version => ranges.every(range => satisfies(version, range)));
	}

	best(ranges: string[]): string | undefined {
		const candidates = this.of(ranges);
		return candidates.find(version => this.#pinned.has(version)) || candidates[0];
	}
}

/**
 * Occurrences of one package whose ranges share at least one published version, and therefore share one
 * release. Membership is decided on the full intersection of the ranges, never on the version that
 * happened to be selected before.
 */
export class Group extends Array<Node> {
	#candidates: Candidates;
	#ranges: string[] = [];

	// Peer requirements that constrain the group without being installed by it
	#peers: Node[] = [];
	get peers() {
		return this.#peers;
	}

	/**
	 * The release of the group: satisfies every member and every attached peer requirement
	 */
	get chosen(): string {
		return this.#candidates.best(this.#ranges);
	}

	// Array methods that create arrays (map, filter) must not build groups
	static get [Symbol.species]() {
		return Array;
	}

	constructor(candidates: Candidates) {
		super();
		this.#candidates = candidates;
	}

	admits(range: string): boolean {
		return this.#candidates.of([...this.#ranges, range]).length > 0;
	}

	register(node: Node) {
		const { range } = node;
		if (!this.admits(range)) throw new Error(`Version "${range}" doesn't intersect with current group`);

		this.push(node);
		this.#ranges.push(range);
	}

	attach(peer: Node) {
		this.#peers.push(peer);
		this.#ranges.push(peer.range);
	}
}
