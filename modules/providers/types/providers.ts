import type { IPackageVersionsResponse, IPackageManifestResponse, IPackumentResponse } from './provider';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';

export /*bundle*/ interface IProvidersOptions extends IProvidersSettingsOptions {}

export /*bundle*/ interface IPackageProviders {
	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	packument?(pkg: string): Promise<IPackumentResponse>;

	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	versions?(pkg: string): Promise<IPackageVersionsResponse>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @param version - The specific version to retrieve.
	 */
	manifest(pkg: string, specifier: string, version: string): Promise<IPackageManifestResponse>;

	/**
	 * Build a tarball request (url + headers) for downloading repository archive at a ref.
	 * This is optional but handy to keep symmetry with semver tarball usage.
	 */
	tarball(pkg: string, specifier: string, version: string): { url: string; headers: Record<string, string> };
}
