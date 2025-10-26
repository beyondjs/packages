import type { IPackageManifestResponse, IPackumentResponse } from './providers';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import type { ICacheOptions } from './providers';

export /*bundle*/ interface IPackageProvider {
	/**
	 * Retrieves the packument for a specific package (only for semver)
	 */
	packument?(dependency: DependencySourceProvider, cache?: ICacheOptions): Promise<IPackumentResponse>;

	/**
	 * Retrieves the package specification for a specific release
	 */
	manifest(dependency: DependencySourceRelease, cache?: ICacheOptions): Promise<IPackageManifestResponse>;

	/**
	 * Builds a download URL for a package given its scope and name
	 */
	tarball(dependency: DependencySourceRelease): Promise<{ url: string; headers: Record<string, string> }>;
}
