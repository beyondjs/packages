import type { Project } from '../';
import { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import * as printer from '@beyond-js/packages/dependencies/printer';
import * as fs from 'fs';
import { DependenciesDownloader } from './downloader';

export class DependenciesInstaller {
	#project: Project;
	#downloader: DependenciesDownloader;

	constructor(project: Project) {
		this.#project = project;
		this.#downloader = new DependenciesDownloader(project);
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

	async #done(graph: DependenciesGraph) {
		this.#installing = false;

		// Generate the installation print for console output
		this.#print = {
			packages: printer.packages(graph.registry),
			tree: printer.tree(graph)
		};

		if (!graph.completed) {
			console.warn('Dependencies graph could not be completed');
			return;
		}

		// Generate the lock file
		await this.#project.dependencies.lockfile.generate(graph);

		// Download the dependencies
		const { lockfile } = this.#project.dependencies;
		await this.#downloader.process(lockfile.data);
	}

	async install() {
		this.#installing = true;

		// Build the dependencies graph
		const graph = new DependenciesGraph(this.#project);
		await graph.process({ update: false });

		// Finalize the installation, generating the lock file and downloading packages
		await this.#done(graph);
	}

	async update() {
		this.#updating = true;

		// Build the dependencies graph
		const graph = new DependenciesGraph(this.#project);
		await graph.process({ update: true });

		// Finalize the update, generating the lock file and downloading packages
		await this.#done(graph);
	}
}
