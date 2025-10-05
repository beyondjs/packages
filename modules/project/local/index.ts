import type { IProject } from '@beyond-js/packages/project/types';
import type { Workspace } from '@beyond-js/packages/workspace';
import type { Package } from '@beyond-js/packages/package';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ProjectDependencies } from './dependencies';
import { PackageProviders } from './providers';

export /*bundle*/ class Project extends DynamicProcessor() implements IProject {
	#workspace: Workspace;
	get workspace() {
		return this.#workspace;
	}

	#pkg: Package;
	get pkg() {
		return this.#pkg;
	}

	#name: string;
	get name() {
		return this.#name;
	}

	#version: string;
	get version() {
		return this.#version;
	}

	#dependencies: ProjectDependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#packages: PackageProviders;
	get packages() {
		return this.#packages;
	}

	constructor(workspace: Workspace, name: string, version: string) {
		super();
		this.#workspace = workspace;
		this.#name = name;
		this.#version = version;

		this.#dependencies = new ProjectDependencies(this);
		this.#packages = new PackageProviders(this);
	}

	_process() {
		const pkg = [...this.#workspace.packages.values()].find(
			({ name, version }) => name === this.#name && version === this.#version
		);

		if (!pkg) {
			throw new Error(`The package ${this.#name}@${this.#version} does not exist in the workspace`);
		}

		this.#pkg = pkg;
	}
}
