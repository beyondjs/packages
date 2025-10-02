import { Dependencies } from './dependencies';
import { PackageProviders } from './package-providers';
import { db } from '@beyond-js/packages/persistence/db';

export /*bundle*/ interface IProjectOptions {
	local: { path: string };
	cdn: { project: string };
}

export /*bundle*/ class Project {
	#workspace: string;
	get workspace() {
		return this.#workspace;
	}

	#path: string;
	get path() {
		return this.#path;
	}

	#options: IProjectOptions;
	get options() {
		return this.#options;
	}

	#dependencies: Dependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#packages: PackageProviders;
	get packages() {
		return this.#packages;
	}

	constructor(workspace: Workspace, pkg: string) {
		this.#workspace = workspace;
		this.#path = this.#workspace.packages.get(pkg);
	}

	async initialize() {
		this.#dependencies = new Dependencies();
		this.#packages = new PackageProviders(this);
	}
}
