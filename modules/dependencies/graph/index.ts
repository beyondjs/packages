import type { Providers } from '@beyond-js/packages/providers';
import type { IPackageManifest } from '@beyond-js/packages/types';
import { DependenciesSpec } from '@beyond-js/packages/dependencies/spec';
import { Logger } from '@beyond-js/packages/logs';
import { Registry } from './registry';
import { Node } from './node';

export /*bundle*/ interface IDependenciesGraphConstructorParams {
	providers: Providers;
	manifest: IPackageManifest;
	workspace?: { name: string; version: string }[];
}

export /*bundle*/ class DependenciesGraph extends Node {
	#manifest?: IPackageManifest;

	#workspace?: { name: string; version: string }[];
	get workspace() {
		return this.#workspace;
	}

	#registry: Registry;
	get registry() {
		return this.#registry;
	}

	#logger: Logger;
	get logger(): Logger {
		return this.#logger;
	}

	get completed(): boolean {
		return this.dependencies.completed;
	}

	constructor({ providers, manifest, workspace }: IDependenciesGraphConstructorParams) {
		if (!providers || !manifest) throw new Error('Providers and manifest are required parameters');

		const registry = new Registry(providers);
		const { name, version } = manifest;
		super({ providers, registry, dependency: { kind: 'main', package: name, version } });

		this.#manifest = manifest;
		this.#workspace = workspace;
		this.#registry = registry;
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

		if (deps.every(dep => this.#manifest[dep] === void 0)) {
			await super.process();
		} else {
			const dependencies = new DependenciesSpec(this.#manifest);
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
