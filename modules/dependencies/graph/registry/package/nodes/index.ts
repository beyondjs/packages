import type { DependencyPackage } from '..';
import type { Node } from '../../../node';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { SemverNodes } from './semver';
import { FixedNodes } from './fixed';

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

		if (is === DependencySourceIsType.Semver) {
			await this.#semver.register(node, update);
		} else if (
			[DependencySourceIsType.Git, DependencySourceIsType.Url, DependencySourceIsType.Alias].includes(is)
		) {
			await this.#fixed.register(node, update);
		} else {
			throw new Error(`Unsupported node type: ${is}`);
		}
	}

	unregister(node: Node) {
		const { is } = node.source.data;

		if (is === DependencySourceIsType.Semver) {
			this.#semver.unregister(node);
		} else if (
			[DependencySourceIsType.Git, DependencySourceIsType.Url, DependencySourceIsType.Alias].includes(is)
		) {
			this.#fixed.unregister(node);
		} else {
			throw new Error(`Unsupported node type: ${is}`);
		}
	}
}
