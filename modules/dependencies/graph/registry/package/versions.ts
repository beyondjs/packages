import type { DependencyPackage } from './';
import type { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';

export class PackageSemverVersions {
	#package: DependencyPackage;

	#values: string[];
	get values() {
		return this.#values;
	}

	#error: ProvidersErrorManager;
	get error() {
		return this.#error;
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	async update() {
		// Retrieve the versions of the package
		const { project } = this.#package;
		const { error, versions } = await project.packages.versions(this.#package.name);
		if (error) {
			this.#error = error;
			return;
		}

		this.#values = versions;
	}
}
