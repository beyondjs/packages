import type { Project } from '../';
import { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';

export class DependenciesInstaller {
	#project: Project;

	constructor(project: Project) {
		this.#project = project;
	}

	#installing: boolean = false;
	get installing() {
		return this.#installing;
	}

	#updating: boolean = false;
	get updating() {
		return this.#updating;
	}

	async install() {
		this.#installing = true;

		const graph = new DependenciesGraph(this.#project);
		await graph.install();

		this.#installing = false;
	}

	async update() {
		this.#updating = true;

		const graph = new DependenciesGraph(this.#project);
		await graph.update();

		this.#updating = false;
	}
}
