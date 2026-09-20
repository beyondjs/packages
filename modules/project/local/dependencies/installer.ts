import type { Project } from '../';
import { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import * as printer from '@beyond-js/packages/dependencies/printer';
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
		this.#updating = false;

		// Generate the installation print for console output
		this.#print = {
			packages: printer.packages(graph.registry),
			tree: printer.tree(graph)
		};

		// A graph with a failed occurrence is processed but never completed: nothing is locked or
		// downloaded from it
		if (!graph.completed) {
			console.warn('Dependencies graph could not be completed');
			graph.diagnostics.forEach(({ code, message }) => console.warn(`  ${code}: ${message}`));
			graph.closure?.errors.forEach(({ id, error }) => console.warn(`  ${id}: ${error.code}: ${error.message}`));
			return;
		}

		// Generate the lock file
		await this.#project.dependencies.lockfile.generate(graph);

		// Download the dependencies
		const { lockfile } = this.#project.dependencies;
		const report = await this.#downloader.process(lockfile.data);
		report.diagnostics.forEach(({ code, message }) => console.warn(`  ${code}: ${message}`));
	}

	/**
	 * A local project follows its development dependencies, and its lock file drives the selection
	 */
	#graph(): DependenciesGraph {
		const { lockfile } = this.#project.dependencies;
		const lock = lockfile.loaded ? lockfile.data : void 0;
		return new DependenciesGraph(this.#project, { development: true, lock });
	}

	async install() {
		this.#installing = true;

		// Build the dependencies graph
		const graph = this.#graph();
		await graph.process({ update: false });

		// Finalize the installation, generating the lock file and downloading packages
		await this.#done(graph);
	}

	async update() {
		this.#updating = true;

		// Build the dependencies graph
		const graph = this.#graph();
		await graph.process({ update: true });

		// Finalize the update, generating the lock file and downloading packages
		await this.#done(graph);
	}
}
