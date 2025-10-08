import type { DependencyPackage } from '..';
import type { Node } from '../../../node';
import type { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import { InfoIsType } from '@beyond-js/packages/providers/dependency/info';
import { SemverNodes } from './semver';

export /*bundle*/ class PackageNodes {
	#package: DependencyPackage;

	#semver: SemverNodes;
	get semver() {
		return this.#semver;
	}

	#fixed: Map<string, Node>;
	get fixed() {
		return this.#fixed;
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	async register(node: Node) {
		if (node.info.data.is === InfoIsType.Semver) {
			this.#semver.register(node);
		} else if (node.info.data.is === InfoIsType.Git) {
			// Get the commit version
			const { ref } = node.info.data;
			const commit = 'the commit'; // await this.#package.project.packages.commit(this.#package.name, ref);
			this.#fixed.set(ref, commit);
		} else if (node.info.data.is === InfoIsType.Url) {
		} else if (node.info.data.is === InfoIsType.Alias) {
		}
	}

	async unregister(node: Node) {
		if (this.#info.data.is === InfoIsType.Semver) {
			this.#semver.unregister(node);
		} else {
			this.#fixed.delete(node.version.value);
		}
	}
}
