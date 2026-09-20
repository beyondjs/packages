import type { IPackageManifestResponse, IPackumentResponse, IPackageCommitResponse, ICacheOptions } from './providers';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import type { IDist } from '@beyond-js/packages/types';

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
	 * Pins a git reference to a commit (only for git)
	 */
	commit?(dependency: DependencySourceProvider): Promise<IPackageCommitResponse>;

	/**
	 * Builds the download request of a release. Registries require the `dist` of the release: the archive
	 * URL is the one the registry published, never a synthesized one.
	 */
	tarball(
		dependency: DependencySourceRelease,
		dist?: IDist
	): Promise<{ url?: string; headers?: Record<string, string>; error?: { code: string; message: string } }>;
}
