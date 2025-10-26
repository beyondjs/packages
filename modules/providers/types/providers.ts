import type { IPackageManifest, IPackument } from '@beyond-js/packages/types';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';
import type { DependencySource } from '@beyond-js/packages/dependency-source';
import type { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ interface IProvidersOptions extends IProvidersSettingsOptions {}

export /*bundle*/ interface ICacheOptions {
	etag?: string;
	lastModified?: string;
}

export /*bundle*/ interface IPackageResponseBase {
	error?: IDiagnostic;
	found?: boolean;
	notmodified?: boolean;
	cache?: ICacheOptions;
}

export /*bundle*/ interface IPackumentResponse extends IPackageResponseBase {
	packument?: IPackument;
}

export /*bundle*/ interface IPackageVersionsResponse extends IPackageResponseBase {
	versions?: string[];
}

export /*bundle*/ interface IPackageManifestResponse extends IPackageResponseBase {
	manifest?: IPackageManifest;
}

export /*bundle*/ interface IPackageTarballResponse {
	id: string;
	path: string;
	url: string;
	headers: Record<string, string>;
}

export /*bundle*/ interface IPackageProviders {
	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	packument?(pkg: string, cache?: ICacheOptions): Promise<IPackumentResponse>;

	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	versions?(pkg: string, cache?: ICacheOptions): Promise<IPackageVersionsResponse>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	manifest(source: DependencySource, release: string, cache?: ICacheOptions): Promise<IPackageManifestResponse>;

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	tarball(source: DependencySource, release: string): Promise<IPackageTarballResponse>;
}
