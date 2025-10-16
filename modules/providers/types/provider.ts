import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import type { IPackageManifest, IPackument } from '@beyond-js/packages/types';
import type { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ interface IPackageResponseBase {
	found?: boolean;
	error?: IDiagnostic;
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
	 * Retrieves the packument for a specific package (only for semver)
	 */
	packument?(dependency: DependencySourceProvider): Promise<IPackumentResponse>;

	/**
	 * Retrieves the package specification for a specific release
	 */
	manifest(dependency: DependencySourceRelease): Promise<IPackageManifestResponse>;

	/**
	 * Builds a download URL for a package given its scope and name
	 */
	tarball(dependency: DependencySourceProvider, release?: string): { url: string; headers: Record<string, string> };
}
