import type { DependencyPackage } from '..';
import type { Node } from '../../../node';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { SemverNodes } from './semver';
import { FixedNodes } from './fixed';

/**
 * The occurrences that require one package, by how their version is determined
 */
export /*bundle*/ class PackageNodes {
	#semver: SemverNodes;
	get semver() {
		return this.#semver;
	}

	#fixed: FixedNodes;
	get fixed() {
		return this.#fixed;
	}

	constructor(pkg: DependencyPackage) {
		this.#semver = new SemverNodes(pkg);
		this.#fixed = new FixedNodes(pkg);
	}

	async register(node: Node, update: boolean) {
		const { is } = node.source.data;

		// An alias never arrives here: an occurrence is registered under the source it targets
		if (is === DependencySourceIsType.Semver) await this.#semver.register(node, update);
		else if (is === DependencySourceIsType.Git || is === DependencySourceIsType.Url) {
			await this.#fixed.register(node, update);
		} else {
			const code = 'SOURCE_UNSUPPORTED';
			node.version.update({ error: { code, message: `Dependency sources of type "${is}" are not supported` } });
		}
	}

	unregister(node: Node) {
		const { is } = node.source.data;
		if (is === DependencySourceIsType.Semver) this.#semver.unregister(node);
		else this.#fixed.unregister(node);
	}
}
