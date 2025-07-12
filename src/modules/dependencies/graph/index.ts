import type { Logger } from '@beyond-js/logs/main';
import { DependenciesList } from './list';
import { DependenciesNode } from './node';

export /*bundle*/ interface IDependenciesSpecs {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	optionalDependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
}

export /*bundle*/ interface IPackageSpecs extends IDependenciesSpecs {
	name: string;
	version: string;
}

export /*bundle*/ interface IDependenciesGraphConstructorParams {
	specs: IPackageSpecs;
	workspace?: { name: string; version: string }[];
	logger: Logger;
}

export /*bundle*/ class DependenciesGraph extends DependenciesNode {
	#specs: IDependenciesSpecs;

	#workspace: { name: string; version: string }[];
	get workspace() {
		return this.#workspace;
	}

	#list: DependenciesList;
	get list() {
		return this.#list;
	}

	#logger: Logger;

	get completed(): boolean {
		return this.dependencies.completed;
	}

	constructor({ specs, workspace, logger }: IDependenciesGraphConstructorParams) {
		const list = new DependenciesList();
		const { name, version } = specs;
		super(list, name, version);

		this.#specs = specs;
		this.#workspace = workspace;
		this.#list = list;
		this.#logger = logger;
	}

	async process() {
		this.#logger.add('Process has been started');

		console.log('done!');
		return;

		// The root node version is the version of the package for which dependencies are being processed
		// This version value can be treated as arbitrary, as it will not have impact
		// in the process of the dependencies graph
		this.version.update({ version: this.version.specified });

		// Process the dependencies of the root node of the graph
		const dependencies = new DependenciesSpecs(this.#specs);
		await this.dependencies.process(dependencies);

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
