import type { IProject } from '@beyond-js/packages/project/types';
import type { Registry } from '../';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { PackageNodes } from './nodes';
import { PackageSemverVersions } from './versions';

/**
 * One required package: the occurrences that require it and, for registries, its published versions
 */
export class DependencyPackage {
	#project: IProject;
	get project() {
		return this.#project;
	}

	#registry: Registry;
	get registry() {
		return this.#registry;
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

	constructor(project: IProject, source: DependencySource, registry: Registry) {
		this.#project = project;
		this.#source = source;
		this.#registry = registry;
		this.#nodes = new PackageNodes(this);
		this.#versions = new PackageSemverVersions(this);
	}
}
