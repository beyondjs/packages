import type { DependencyResolution } from '@beyond-js/packages/dependencies/resolution';
import type { RepositoriesSettings } from '@beyond-js/packages/repositories/settings';
import type { IPackageSpecResponse } from './types';
import { PackageResolutionType } from '@beyond-js/packages/repositories/types';
import { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import type { Logger } from '@beyond-js/packages/logs';
import { SemverRegistry } from './semver';

export /*bundle*/ class Registries extends Map {
	#semver: SemverRegistry;
	get semver() {
		return this.#semver;
	}

	constructor(settings: RepositoriesSettings) {
		super();
		this.#semver = new SemverRegistry(settings);

		super.set('semver', this.#semver);
	}

	async versions(dependency: DependencyResolution, logger?: Logger): Promise<RepositoriesResponse<string[]>> {
		switch (dependency.is) {
			case PackageResolutionType.Semver:
				return await this.#semver.versions(dependency.name, logger);
			default:
				throw new Error(`Versions retrieval not supported for dependency type: "${dependency.is}"`);
		}
	}

	async spec(dependency: DependencyResolution, logger?: Logger): Promise<RepositoriesResponse<IPackageSpecResponse>> {
		switch (dependency.is) {
			case PackageResolutionType.Semver:
				return this.#semver.spec(dependency.name, logger);
			case PackageResolutionType.Git:
				return this.#git.spec(dependency.git!, logger);
			case PackageResolutionType.Url:
				return this.#url.spec(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${dependency.is}`);
		}
	}
}
