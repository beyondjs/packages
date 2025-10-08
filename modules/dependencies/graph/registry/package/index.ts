import type { IProject } from '@beyond-js/packages/project/types';
import { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import { PackageNodes } from './nodes';
import { PackageSemverVersions } from './versions';

export class DependencyPackage {
	// The package name
	#name: string;
	get name() {
		return this.#name;
	}

	#project: IProject;
	get project() {
		return this.#project;
	}

	// The versions of the package (only when a semver node is registered)
	#versions: PackageSemverVersions;
	get versions() {
		return this.#versions;
	}

	#nodes: PackageNodes;
	get nodes() {
		return this.#nodes;
	}

	constructor(name: string, project: IProject) {
		this.#name = name;
		this.#project = project;
		this.#nodes = new PackageNodes(this);
		this.#versions = new PackageSemverVersions(this);
	}
}
