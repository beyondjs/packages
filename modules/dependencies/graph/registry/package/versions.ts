import type { DependencyPackage } from './';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { valid } from 'semver';

/**
 * The versions a registry publishes for a package
 */
export class PackageSemverVersions {
	#package: DependencyPackage;

	#value: string[] = [];
	get value() {
		return this.#value;
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	#ready: Promise<void>;
	get ready() {
		return this.#ready || this.update();
	}

	constructor(pkg: DependencyPackage) {
		this.#package = pkg;
	}

	update(): Promise<void> {
		this.#ready = this.#load();
		return this.#ready;
	}

	/**
	 * Never rejects: a failure is kept as `error`, which every occurrence of the package then reports
	 */
	async #load(): Promise<void> {
		const { project, source } = this.#package;
		this.#value = [];
		this.#error = void 0;

		if (source.data.is !== DependencySourceIsType.Semver) {
			const code = 'SOURCE_UNSUPPORTED';
			this.#error = { code, message: `Versions are only published for registry packages: "${source.package}"` };
			return;
		}

		try {
			const { error, found, versions } = await project.packages.versions(source.package);
			if (error) {
				this.#error = error;
			} else if (found === false || !versions) {
				const code = 'PACKAGE_NOT_FOUND';
				this.#error = { code, message: `Package "${source.package}" was not found in its registry` };
			} else {
				this.#value = versions.filter(version => valid(version));
			}
		} catch (exc) {
			const code = 'PACKAGE_VERSIONS_FAILED';
			this.#error = { code, message: `The versions of "${source.package}" could not be obtained` };
		}
	}
}
