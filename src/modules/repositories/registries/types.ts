import type { RepositoriesErrorManager } from '@beyond-js/packages/repositories/errors';
import type { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import type { IPackageSpec, IRepositoryAuth, RepositoryType } from '@beyond-js/packages/repositories/types';

export /*bundle*/ interface IRegistry {
	/**
	 * Returns the registry name.
	 */
	type: RepositoryType;

	/**
	 * Returns the registry host.
	 * This is typically the domain part of the URL (e.g., 'registry.npmjs.org').
	 * It is used to identify the registry in requests and configurations.
	 * For example, 'registry.npmjs.org' for npm, 'npm.pkg.github.com' for GitHub Packages, etc.
	 */
	host: string;

	/**
	 * Returns the registry URL.
	 */
	url: string;

	/**
	 * Returns the authentication details for the registry.
	 */
	auth(): IRepositoryAuth;

	/**
	 * Returns the headers to be used for requests to this registry.
	 */
	headers(): Record<string, string>;

	/**
	 * Builds a download URL for a package given its scope and name.
	 *
	 * @param scope - The package scope (e.g., '@scope').
	 * @param name - The package name (e.g., 'package-name').
	 * @returns The download URL for the package.
	 */
	tarball(scope: string, name: string): string;

	versions(pkg: string): Promise<RepositoriesResponse<string[]>>;
	spec(name: string, version: string): Promise<RepositoriesResponse<IPackageSpecResponse>>;
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

export /*bundle*/ interface IPackageVersionsResponse {
	host: string;
	name: string;
	found: boolean;
	valid?: boolean;
	value?: string[];
	error?: RepositoriesErrorManager;
}
