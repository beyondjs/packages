import type { IPackageVersionsResponse, IPackageManifestResponse } from '@beyond-js/packages/providers/types';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';
import { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import { InfoIsType } from '@beyond-js/packages/providers/dependency/info';
import { SemverRegistry } from './semver';
import { GitProvider } from './git';

export /*bundle*/ class Providers extends Map {
	#settings: ProvidersSettings;

	#semver: SemverRegistry;
	get semver() {
		return this.#semver;
	}

	#git: GitProvider;
	get git() {
		return this.#git;
	}

	constructor(options: IProvidersSettingsOptions) {
		super();
		this.#settings = new ProvidersSettings(options);
		this.#semver = new SemverRegistry();
		this.#git = new GitProvider();

		this.set('semver', this.#semver);
		this.set('git', this.#git);
	}

	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	async versions(pkg: string): Promise<IPackageVersionsResponse> {
		const dependency = new DependencyInfo(pkg, void 0, this.#settings);
		return await this.#semver.versions(dependency);
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @param version - The specific version to retrieve.
	 */
	async manifest(pkg: string, specifier: string, version: string): Promise<IPackageManifestResponse> {
		const dependency = new DependencyInfo(pkg, specifier, this.#settings);

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
