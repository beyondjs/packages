import type { DependencyInfo } from '@beyond-js/packages/dependencies/info';
import type { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import type { ProvidersResponse } from '@beyond-js/packages/providers/response';
import type { IPackageManifest } from '@beyond-js/packages/types';

export /*bundle*/ interface IProvider {
	/**
	 * Builds a download URL for a package given its scope and name.
	 *
	 * @param scope - The package scope (e.g., '@scope').
	 * @param name - The package name (e.g., 'package-name').
	 * @returns The download URL for the package.
	 */
	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> };

	/**
	 * Retrieves the available versions for a package.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param logger - Optional logger for logging purposes.
	 * @returns A promise that resolves to a ProvidersResponse containing an array of available versions or an error.
	 */
	versions?(pkg: string): Promise<ProvidersResponse<string[]>>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param name - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param version - The specific version to retrieve.
	 */
	manifest(dependency: DependencyInfo): Promise<ProvidersResponse<IPackageManifestResponse>>;
}

export /*bundle*/ interface IPackageManifestResponseBase {
	host: string;
	name: string;
	found: boolean;
	valid?: boolean;
	error?: ProvidersErrorManager;
}

export /*bundle*/ interface IPackageManifestResponse extends IPackageManifestResponseBase {
	version: string;
	value?: IPackageManifest;
}

export /*bundle*/ interface IPackageManifestsResponse extends IPackageManifestResponseBase {
	value?: { versions: IPackageManifest[] };
}

export /*bundle*/ interface IPackageVersionsResponse extends IPackageManifestResponseBase {
	value?: string[];
}
