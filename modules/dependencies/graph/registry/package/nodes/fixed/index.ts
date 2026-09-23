import type { DependencyPackage } from '../..';
import type { Node } from '../../../../node';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';

const SRI = /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/;

/**
 * Occurrences whose release is fixed by the source itself instead of selected from a range: a git
 * reference pinned to a commit, and an archive URL pinned by its content integrity, the one it declares or,
 * without one, the one of the archive downloaded once. A source that cannot be pinned is reported on the
 * occurrence; nothing is ever pinned to a placeholder.
 */
export class FixedNodes extends Map<string, Array<Node>> {
	#package: DependencyPackage;

	constructor(pkg: DependencyPackage) {
		super();
		this.#package = pkg;
	}

	#unsupported(message: string) {
		return { code: 'SOURCE_UNSUPPORTED', message };
	}

	/**
	 * The release of the occurrence, or why it cannot be pinned
	 */
	async #pin(node: Node): Promise<{ release?: string; error?: { code: string; message: string } }> {
		const { data } = node.source;
		const { packages } = this.#package.project;

		if (data.is === DependencySourceIsType.Git) {
			if (typeof packages.commit !== 'function') {
				return { error: this.#unsupported('The package providers of the project cannot pin git references') };
			}

			const { commit, error } = await packages.commit(node.source);
			if (error) return { error };
			if (!commit) return { error: this.#unsupported(`No commit was obtained for "${node.source.id}"`) };
			return { release: commit };
		}

		if (data.is === DependencySourceIsType.Url) {
			// The declared integrity pins the content; without one, the archive is downloaded once and its
			// digest pins it
			let integrity = data.integrity;
			if (integrity === void 0) {
				if (typeof packages.archive !== 'function') {
					return { error: this.#unsupported('The package providers of the project cannot pin archive URLs') };
				}
				const pinned = await packages.archive(node.source);
				if (pinned.error) return { error: pinned.error };
				integrity = pinned.integrity;
			}

			const match = SRI.exec(integrity || '');
			if (!match) {
				const code = 'INTEGRITY_UNSUPPORTED';
				const message =
					`The integrity the archive URL of "${node.package}" declares as its fragment must be one ` +
					`sha512 or sha256 value ("#sha512-…"): its content cannot be pinned otherwise`;
				return { error: { code, message } };
			}

			const digest = Buffer.from(match[2], 'base64').toString('hex');
			return { release: `0.0.0-url.${digest.slice(0, 32)}` };
		}

		return { error: this.#unsupported(`Dependency sources of type "${data.is}" are not supported`) };
	}

	async register(node: Node, update: boolean) {
		const { release, error } = await this.#pin(node);
		if (error) {
			// Registered under no release, so that unregistering it stays symmetrical
			node.version.update({ error });
			this.set('', [...(this.get('') || []), node]);
			return;
		}

		node.version.update({ version: release });
		this.set(release, [...(this.get(release) || []), node]);
	}

	unregister(node: Node) {
		for (const [release, nodes] of this) {
			const index = nodes.indexOf(node);
			if (index === -1) continue;

			nodes.splice(index, 1);
			!nodes.length && this.delete(release);
			return;
		}
	}
}
