import type { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import type { IPackageManifest, IPackument } from '@beyond-js/packages/types';

export /*bundle*/ interface IPackageResponseBase {
	found?: boolean;
	error?: ProvidersErrorManager;
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

export /*bundle*/ interface IProvider {
	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	versions?(pkg: string): Promise<IPackageVersionsResponse>;

	/**
	 * Retrieves the packument for a specific package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 */
	packument?(pkg: string, abbreviated?: boolean): Promise<IPackumentResponse>;

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
	 * Builds a download URL for a package given its scope and name.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @returns The download URL for the package.
	 */
	tarball(pkg: string, specifier: string): { url: string; headers: Record<string, string> };
}
