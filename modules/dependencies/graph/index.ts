import type { IPackageManifest } from '@beyond-js/packages/types';
import type { IProject } from '@beyond-js/packages/project/types';
import { DependenciesSpec } from '@beyond-js/packages/dependencies/spec';
import { Logger } from '@beyond-js/packages/logs';
import { Registry } from './registry';
import { Node } from './node';

export /*bundle*/ class DependenciesGraph extends Node {
	#project: IProject;

	#logger: Logger;
	get logger(): Logger {
		return this.#logger;
	}

	get completed(): boolean {
		return this.dependencies.completed;
	}

	constructor(project: IProject) {
		if (!project.processed) {
			throw new Error('The project must be processed before creating the dependencies graph');
		}

		const { name, version } = project;
		const registry = new Registry(project);
		super({ project, registry, dependency: { kind: 'main', package: name, version } });

		this.#project = project;
		this.#logger = new Logger({ console: true });
	}

	async process() {
		this.#logger.info('Initializing dependencies graph');

		// The root node version is the version of the package for which dependencies are being processed
		// This version value can be treated as arbitrary, as it will not have impact
		// in the process of the dependencies graph
		this.version.update({ version: this.version.specified });

		// Process the dependencies of the root node of the graph
		const deps: ['dependencies', 'devDependencies', 'peerDependencies'] = [
			'dependencies',
			'devDependencies',
			'peerDependencies'
		];

		if (deps.every(dep => this.#project.dependencies.spec[dep] === void 0)) {
			await super.process();
		} else {
			const dependencies = new DependenciesSpec(this.#project.dependencies.spec);
			await this.dependencies.process(dependencies);
		}

		let i = 0;
		while (!this.completed) {
			// @TODO: handle this error when the graph cannot be completed after a number of incompleted iterations
			i++;
			if (i > 10) break;

			// The graph may not have been completely processed due to invalidations that occur while
			// processing the nodes
			await this.dependencies.reprocess();
		}
	}
}
