import type { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import type { IPackageManifest, IPackument } from '@beyond-js/packages/types';
import type { DependencyInfo } from '@beyond-js/packages/dependencies/info';

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
	 * Retrieves the available versions for a package.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param logger - Optional logger for logging purposes.
	 * @returns
	 */
	versions?(pkg: string): Promise<IPackageVersionsResponse>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param name - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 */
	packument?(pkg: string, abbreviated?: boolean): Promise<IPackumentResponse>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param dependency - The dependency info processed from the package name and version specifier.
	 * @param version - The specific version to retrieve.
	 */
	manifest(dependency: DependencyInfo, version: string): Promise<IPackageManifestResponse>;

	/**
	 * Builds a download URL for a package given its scope and name.
	 *
	 * @param dependency - The dependency info processed from the package name and version specifier.
	 * @returns The download URL for the package.
	 */
	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> };
}
