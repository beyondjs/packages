import type { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
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

export /*bundle*/ interface IPackageProvider {
	/**
	 * Retrieves the available versions for a package (only for semver).
	 */
	versions?(dependency: DependencyInfo): Promise<IPackageVersionsResponse>;

	/**
	 * Retrieves the packument for a specific package (only for semver).
	 */
	packument?(dependency: DependencyInfo): Promise<IPackumentResponse>;

	/**
	 * Retrieves the package specification for a specific version.
	 */
	manifest(dependency: DependencyInfo, version: string): Promise<IPackageManifestResponse>;

	/**
	 * Builds a download URL for a package given its scope and name.
	 */
	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> };
}
