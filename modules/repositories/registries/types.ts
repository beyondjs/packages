import type { DependencyResolution } from '@beyond-js/packages/dependencies/resolution';
import type { RepositoriesErrorManager } from '@beyond-js/packages/repositories/errors';
import type { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import type { IPackageSpec, IRepositoryAuth, RepositoryType } from '@beyond-js/packages/repositories/types';

export /*bundle*/ interface IRegistry {
	/**
	 * Builds a download URL for a package given its scope and name.
	 *
	 * @param scope - The package scope (e.g., '@scope').
	 * @param name - The package name (e.g., 'package-name').
	 * @returns The download URL for the package.
	 */
	tarball(dependency: DependencyResolution): { url: string; headers: Record<string, string> };

	/**
	 * Retrieves the available versions for a package.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param logger - Optional logger for logging purposes.
	 * @returns A promise that resolves to a RepositoriesResponse containing an array of available versions or an error.
	 */
	versions?(pkg: string): Promise<RepositoriesResponse<string[]>>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param name - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param version - The specific version to retrieve.
	 */
	spec(dependency: DependencyResolution): Promise<RepositoriesResponse<IPackageSpecResponse>>;
}

export /*bundle*/ interface IPackageSpecResponse {
	host: string;
	name: string;
	version: string;
	found: boolean;
	valid?: boolean;
	value?: IPackageSpec;
	error?: RepositoriesErrorManager;
}

export /*bundle*/ interface IPackageSpecsResponse {
	host: string;
	name: string;
	found: boolean;
	valid?: boolean;
	value?: { versions: IPackageSpec[] };
	error?: RepositoriesErrorManager;
}

export /*bundle*/ interface IPackageVersionsResponse {
	host: string;
	name: string;
	found: boolean;
	valid?: boolean;
	value?: string[];
	error?: RepositoriesErrorManager;
}
