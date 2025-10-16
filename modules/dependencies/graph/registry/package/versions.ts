import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import type { DependencyPackage } from './';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export class PackageSemverVersions {
	#package: DependencyPackage;

	#value: string[];
	get value() {
		return this.#value;
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	#ready: PendingPromise<void>;
	get ready() {
		if (this.#ready) return this.#ready;

		this.update();
		return this.#ready;
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	async update() {
		this.#ready = new PendingPromise<void>();

		if (this.#package.source.data.is !== DependencySourceIsType.Semver) {
			this.#ready.reject('Package versions are only available on semver sources');
			return;
		}

		// Retrieve the versions of the package
		const { project, source } = this.#package;
		const { error, versions } = await project.packages.versions(source.package);
		if (error) {
			this.#error = error;
			return;
		}

		this.#value = versions;
		this.#ready.resolve();
	}
}
