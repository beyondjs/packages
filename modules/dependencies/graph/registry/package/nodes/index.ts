import type { DependencyPackage } from '..';
import type { Node } from '../../../node';
import { InfoIsType } from '@beyond-js/packages/providers/dependency/info';
import { SemverNodes } from './semver';
import { FixedNodes } from './fixed';

export /*bundle*/ class PackageNodes {
	#package: DependencyPackage;

	#semver: SemverNodes;
	get semver() {
		return this.#semver;
	}

	#fixed: FixedNodes;
	get fixed() {
		return this.#fixed;
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;

		this.#semver = new SemverNodes(pkg);
		this.#fixed = new FixedNodes(pkg);
	}

	async register(node: Node) {
		if (node.info.data.is === InfoIsType.Semver) {
			await this.#semver.register(node);
		} else if ([InfoIsType.Git, InfoIsType.Url, InfoIsType.Alias].includes(node.info.data.is)) {
			await this.#fixed.register(node);
		} else {
			throw new Error(`Unsupported node type: ${node.info.data.is}`);
		}
	}

	unregister(node: Node) {
		if (node.info.data.is === InfoIsType.Semver) {
			this.#semver.unregister(node);
		} else if ([InfoIsType.Git, InfoIsType.Url, InfoIsType.Alias].includes(node.info.data.is)) {
			this.#fixed.unregister(node);
		} else {
			throw new Error(`Unsupported node type: ${node.info.data.is}`);
		}
	}
}
