import type { DependencyPackage } from '..';
import type { Node } from '../../../node';
import { DependencyIsType } from '@beyond-js/packages/providers/dependency/parser';
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

	async register(node: Node) {
		if (node.data.is === DependencyIsType.Semver) {
			await this.#semver.register(node);
		} else if ([DependencyIsType.Git, DependencyIsType.Url, DependencyIsType.Alias].includes(node.data.is)) {
			await this.#fixed.register(node);
		} else {
			throw new Error(`Unsupported node type: ${node.data.is}`);
		}
	}

	unregister(node: Node) {
		if (node.data.is === DependencyIsType.Semver) {
			this.#semver.unregister(node);
		} else if ([DependencyIsType.Git, DependencyIsType.Url, DependencyIsType.Alias].includes(node.data.is)) {
			this.#fixed.unregister(node);
		} else {
			throw new Error(`Unsupported node type: ${node.data.is}`);
		}
	}
}
