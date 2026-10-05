import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IWorkspaceMember } from '@beyond-js/packages/project/types';
import type { Node } from '.';
import { type INodeRelease, Release } from './release';

/**
 * The release an occurrence resolved to, and which occurrence expands it. A release is expanded once, by the
 * first occurrence that claims it; every other occurrence links to that one. This is also the visited guard of
 * the graph: a cycle reaches a release an ancestor already claimed, links to it and stops.
 *
 * A registry, git or archive release is claimed by its source and version. A member of a workspace is claimed by
 * its node key (`workspace:<id>`), and its importer claims it as soon as it registers, before anything is
 * expanded: every other occurrence of the member links to the importer, which expands it as the top it is.
 */
export class Claim {
	#node: Node;

	#link?: Node;
	/**
	 * The occurrence that expands the release, when it is not this one
	 */
	get link() {
		return this.#link;
	}

	#release?: INodeRelease;
	/**
	 * What is known of the release: described by this occurrence, or read through its link
	 */
	get release(): INodeRelease | undefined {
		return this.#link ? this.#link.release : this.#release;
	}

	/**
	 * The member of the workspace the occurrence resolved to, for a workspace source
	 */
	get member(): IWorkspaceMember | undefined {
		const { registry, source } = this.#node;
		return registry.packages.get(source?.id)?.nodes.workspace.member(this.#node);
	}

	/**
	 * The key the release is claimed with
	 */
	get key(): string {
		const { member } = this;
		const { source, version } = this.#node;
		return member ? `workspace:${member.id}` : `${source.id}@${version.resolved}`;
	}

	constructor(node: Node) {
		this.#node = node;
	}

	/**
	 * Claims the release, and describes it when this occurrence is the one that expands it
	 *
	 * @returns Why the release could not be described, if so
	 */
	async take(): Promise<IDiagnostic | void> {
		const node = this.#node;
		const owner = node.registry.releases.claim(this.key, node);
		if (owner !== node) {
			this.#link = owner;
			return;
		}

		const release = new Release();
		const error = await release.load(node.project.packages, node.source, node.version.resolved, this.member);
		if (error) return error;
		this.#release = release;
	}

	/**
	 * Forgets the link before the occurrence is processed again
	 */
	reset() {
		this.#link = void 0;
	}
}
