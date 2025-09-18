import type { DependencyInfo } from '@beyond-js/packages/dependencies/info';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import type { IPackageSpecResponse } from './types';
import type { Logger } from '@beyond-js/packages/logs';
import { InfoIsType } from '@beyond-js/packages/dependencies/info';
import { ProvidersResponse } from '@beyond-js/packages/providers/response';
import { SemverRegistry } from './semver';

export /*bundle*/ class Registries extends Map {
	#semver: SemverRegistry;
	get semver() {
		return this.#semver;
	}

	constructor(settings: ProvidersSettings) {
		super();
		this.#semver = new SemverRegistry(settings);

		super.set('semver', this.#semver);
	}

	/**
	 * Retrieves the available versions for a given dependency.
	 *
	 * @param dependency The dependency info as it is defined in package.json
	 * @param version The version specifier as it is defined in package.json
	 * @param logger
	 * @returns
	 */
	async versions(dependency: DependencyInfo, logger?: Logger): Promise<ProvidersResponse<string[]>> {
		const { is } = dependency.data;
		switch (is) {
			case InfoIsType.Semver:
				return await this.#semver.versions(dependency.package, dependency.scope, logger);
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
	async spec(
		dependency: DependencyInfo,
		version: string,
		logger?: Logger
	): Promise<ProvidersResponse<IPackageSpecResponse>> {
		const { is } = dependency.data;
		switch (is) {
			case InfoIsType.Semver:
				return this.#semver.spec(dependency.package, version, dependency.scope, logger);
			case InfoIsType.Git:
				return this.#git.spec(dependency.git!, logger);
			case InfoIsType.Url:
				return this.#url.spec(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${is}`);
		}
	}
}
