import type { Project } from '../';
import { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import * as printer from '@beyond-js/packages/dependencies/printer';

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

	#print: { packages: string; tree: string };
	get print() {
		return this.#print;
	}

	#done(graph: DependenciesGraph) {
		this.#installing = false;

		this.#print = {
			packages: printer.packages(graph.registry),
			tree: printer.tree(graph)
		};
	}

	async install() {
		this.#installing = true;

		const graph = new DependenciesGraph(this.#project);
		await graph.process();
		this.#done(graph);
	}

	async update() {
		this.#updating = true;

		const graph = new DependenciesGraph(this.#project);
		await graph.process();
		this.#done(graph);
	}
}
