import type { IProject } from '@beyond-js/packages/project/types';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { PackageNodes } from './nodes';
import { PackageSemverVersions } from './versions';

export class DependencyPackage {
	#project: IProject;
	get project() {
		return this.#project;
	}

	#source: DependencySource;
	get source() {
		return this.#source;
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

	constructor(project: IProject, source: DependencySource) {
		this.#project = project;
		this.#source = source;
		this.#nodes = new PackageNodes(this);
		this.#versions = new PackageSemverVersions(this);
	}
}
