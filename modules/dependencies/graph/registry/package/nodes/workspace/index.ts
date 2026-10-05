import type { DependencyPackage } from '../..';
import type { Node } from '../../../../node';
import type { IWorkspaceMember } from '@beyond-js/packages/project/types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IWorkspaceDependencySource } from '@beyond-js/packages/dependency-source';
import { MemberRange } from './range';

/**
 * The occurrences of a name the workspace provides. Each one takes the highest member version that satisfies its
 * own range, and a `workspace:<id>` source takes the member it names, without asking any provider. Unlike the
 * releases of a registry, members are not grouped: two dependents whose ranges select different members use
 * each its own, and nothing outside the workspace ever satisfies the name.
 */
export class WorkspaceNodes {
	#package: DependencyPackage;
	#nodes: Set<Node> = new Set();
	#selected: Map<Node, IWorkspaceMember> = new Map();
	#peers: Set<Node> = new Set();

	/**
	 * The occurrences registered, peer requirements included
	 */
	get size() {
		return this.#nodes.size + this.#peers.size;
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	/**
	 * The member an occurrence resolved to
	 */
	member(node: Node): IWorkspaceMember | undefined {
		return this.#selected.get(node);
	}

	/**
	 * Selects the member of an occurrence. A peer requirement takes the member of the occurrence that provides it,
	 * and is concluded when the pass ends.
	 */
	register(node: Node): void {
		if (node.soft) {
			this.#peers.add(node);
			return;
		}

		this.#nodes.add(node);
		const { member, error } = this.#select(node);
		if (error) return node.version.update({ error });

		this.#selected.set(node, member);
		node.version.update({ version: member.version });
	}

	/**
	 * Forgets an occurrence and what it selected; forgetting one that is not registered is not an error
	 */
	unregister(node: Node) {
		this.#nodes.delete(node);
		this.#selected.delete(node);
		this.#peers.delete(node);
	}

	/**
	 * Concludes the peer requirements of this name: each one is met when the member its provider resolved to
	 * satisfies the required range
	 */
	conclude(): void {
		const peers = [...this.#peers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		for (const peer of peers) {
			const provided = this.#selected.get(peer.provider);
			const data = <IWorkspaceDependencySource>peer.source.data;
			const met =
				data.member !== void 0
					? provided?.id === data.member
					: new MemberRange(data.range).test(provided?.version);
			peer.conclude(!!provided && met);
		}
	}

	#select(node: Node): { member?: IWorkspaceMember; error?: IDiagnostic } {
		const { members } = this.#package.project;
		const name = node.source.package;
		const required = `"${name}@${node.version.specified}"`;
		const consumer = node.id.split('>').slice(1, -1).join(' > ');

		if (!members) {
			const message = `${required} requires a member of a workspace, and it is not resolved in a workspace`;
			return { error: { code: 'SOURCE_UNSUPPORTED', message } };
		}

		const data = <IWorkspaceDependencySource>node.source.data;
		if (data.member !== void 0) {
			// The root package is an importer of the workspace, never a dependency, unless it is also a member
			const member = members.member(data.member);
			if (member && (node.importer || members.instances(member.name).includes(member))) return { member };

			const message = `${consumer} requires ${required}, and the workspace has no member "${data.member}"`;
			return { error: { code: 'WORKSPACE_PACKAGE_NOT_FOUND', message } };
		}

		const instances = members.instances(name);
		if (!instances.length) {
			const message = `${consumer} requires ${required}, and no member of the workspace provides "${name}"`;
			return { error: { code: 'WORKSPACE_PACKAGE_NOT_FOUND', message } };
		}

		const range = new MemberRange(data.range);
		const member = instances.find(({ version }) => range.test(version));
		if (member) return { member };

		const versions = instances.map(({ version }) => version).join(', ');
		const ids = instances.map(({ id }) => id).join(', ');
		const message = `${consumer} requires ${required}; the workspace provides ${versions} (${ids})`;
		return { error: { code: 'WORKSPACE_RANGE_UNSATISFIED', message } };
	}
}
