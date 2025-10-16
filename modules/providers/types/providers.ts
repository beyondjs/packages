import type { IPackageVersionsResponse, IPackageManifestResponse, IPackumentResponse } from './provider';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';
import type { DependencySource } from '@beyond-js/packages/dependency-source';

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
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	manifest(source: DependencySource, release: string): Promise<IPackageManifestResponse>;

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version (only for semver)
	 */
	tarball(source: DependencySource, release?: string): { url: string; headers: Record<string, string> };
}
