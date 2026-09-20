import type { DependencyPackage } from '../..';
import type { Node } from '../../../../node';
import type { Selection } from '../../../../selection';
import { Group, Candidates } from './group';
import { rcompare } from 'semver';

// Code unit order: the same on every host, unlike a locale-aware comparison
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The occurrences that require one registry package with a version range, and the groups they form.
 *
 * While a pass walks the graph, an occurrence takes the version the previous pass selected for it, or
 * the best one for its own range. When the pass ends, `regroup` partitions all the occurrences at once
 * in a canonical order, so the groups do not depend on the order the occurrences were found in.
 */
export class SemverNodes {
	#package: DependencyPackage;
	#nodes: Set<Node> = new Set();
	#peers: Set<Node> = new Set();

	#groups: Group[] = [];
	get groups() {
		return this.#groups;
	}

	get size() {
		return this.#nodes.size + this.#peers.size;
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	#select(): Candidates {
		const { versions, registry, source } = this.#package;
		return new Candidates(versions.value, registry.policy?.lock.versions(source.package) || []);
	}

	#unresolved(node: Node) {
		const { versions, source } = this.#package;
		const code = 'VERSION_UNRESOLVED';
		const message =
			`No published version of "${source.package}" satisfies "${node.range}" ` +
			`(${versions.value.length} versions published)`;
		return { code, message };
	}

	async register(node: Node, update: boolean) {
		const { versions, registry } = this.#package;
		await versions.ready;

		(node.soft ? this.#peers : this.#nodes).add(node);
		if (versions.error) return node.version.update({ error: versions.error });

		// A peer requirement takes the version of the occurrence that provides it
		if (node.soft) return;

		const candidates = this.#select();
		const selected = registry.selection.get(node.id);
		const admitted = selected && candidates.of([node.range]).includes(selected);
		const version = admitted ? selected : candidates.best([node.range]);

		version ? node.version.update({ version }) : node.version.update({ error: this.#unresolved(node) });
	}

	unregister(node: Node) {
		this.#nodes.delete(node);
		this.#peers.delete(node);
	}

	/**
	 * Groups the occurrences and selects the release of each group
	 *
	 * @param selection Receives the version selected for every occurrence
	 * @returns True when every occurrence was walked with the version selected for it now
	 */
	regroup(selection: Selection): boolean {
		const candidates = this.#select();
		let settled = true;

		// Canonical order: by the best version of each own range, then range, then occurrence
		const hard = [...this.#nodes]
			.filter(node => !node.version.error)
			.map(node => ({ node, own: candidates.best([node.range]) }))
			.filter(({ own }) => !!own)
			.sort((a, b) => rcompare(a.own, b.own) || order(a.node.range, b.node.range) || order(a.node.id, b.node.id));

		this.#groups = [];
		for (const { node } of hard) {
			let group = this.#groups.find(group => group.admits(node.range));
			if (!group) this.#groups.push((group = new Group(candidates)));
			group.register(node);
		}

		// Peer requirements constrain the group of their provider when the intersection allows it
		const peers = [...this.#peers].sort((a, b) => order(a.id, b.id));
		for (const peer of peers) {
			const group = this.#groups.find(group => group.includes(peer.provider));
			const met = !!group && group.admits(peer.range);
			met && group.attach(peer);
			peer.conclude(met);
		}

		for (const group of this.#groups) {
			const { chosen } = group;
			for (const node of [...group, ...group.peers]) {
				selection.set(node.id, chosen);
				if (node.version.resolved !== chosen) settled = false;
			}
		}
		return settled;
	}
}
