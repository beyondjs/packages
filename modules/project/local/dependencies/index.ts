import type { Project } from '../';
import type { IProjectDependencies } from '@beyond-js/packages/project/types';
import { DependenciesInstaller } from './installer';

export class ProjectDependencies implements IProjectDependencies {
	#project: Project;

	get spec() {
		const {
			dependencies,
			devDependencies,
			peerDependencies,
			optionalDependencies,
			bundledDependencies,
			bundleDependencies,
			peerDependenciesMeta
		} = this.#project.package?.manifest || {};

		return {
			dependencies,
			devDependencies,
			peerDependencies,
			optionalDependencies,
			bundledDependencies,
			bundleDependencies,
			peerDependenciesMeta
		};
	}

	#installer: DependenciesInstaller;
	get installer() {
		return this.#installer;
	}

	constructor(project: Project) {
		this.#project = project;
		this.#installer = new DependenciesInstaller(this.#project);
	}

	async install() {
		await this.#installer.install();
	}

	async update() {
		await this.#installer.update();
	}
}
