import type { IPackageVersionsResponse, IPackageManifestResponse } from '@beyond-js/packages/providers/types';
import type { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import { InfoIsType } from '@beyond-js/packages/providers/dependency/info';
import { SemverRegistry } from './semver';
import { GitProvider } from './git';

export /*bundle*/ class Providers extends Map {
	#semver: SemverRegistry;
	get semver() {
		return this.#semver;
	}

	#git: GitProvider;
	get git() {
		return this.#git;
	}

	constructor() {
		super();
		this.#semver = new SemverRegistry();
		this.#git = new GitProvider();

		this.set('semver', this.#semver);
		this.set('git', this.#git);
	}

	/**
	 * Retrieves the available versions for a given dependency.
	 *
	 * @param dependency The dependency info as it is defined in package.json
	 * @returns
	 */
	async versions(dependency: DependencyInfo): Promise<IPackageVersionsResponse> {
		const { is } = dependency.data;
		switch (is) {
			case InfoIsType.Semver:
				return await this.#semver.versions(dependency);
			default:
				throw new Error(`Versions retrieval not supported for dependency type: "${is}"`);
		}
	}

	/**
	 * Retrieves the package specification for a given dependency.
	 *
	 * @param dependency The dependency info as it is defined in package.json
	 * @param version The version as it was resolved in the dependencies tree (only when dependency.is is 'semver')
	 * @param logger
	 * @returns
	 */
	async manifest(dependency: DependencyInfo, version: string): Promise<IPackageManifestResponse> {
		const { is } = dependency.data;
		switch (is) {
			case InfoIsType.Semver:
				return await this.#semver.manifest(dependency, version);
			case InfoIsType.Git:
				return await this.#git.manifest(dependency);
			case InfoIsType.Url:
			// return this.#url.manifest(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${is}`);
		}
	}
}
