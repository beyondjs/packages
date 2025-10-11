import type { Project } from './';
import type {
	IPackageProviders,
	IPackageVersionsResponse,
	IPackageManifestResponse
} from '@beyond-js/packages/providers/types';
import { PackageProviders as PackageProvidersBase } from '@beyond-js/packages/providers';
import { db } from '@beyond-js/packages/persistence/db';

export class PackageProviders implements IPackageProviders {
	#providers: PackageProvidersBase;

	constructor(project: Project) {
		const { workspace, package: pkg } = project;
		this.#providers = new PackageProvidersBase({ workspace: workspace.path, path: pkg.path });
	}

	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	async versions(pkg: string): Promise<IPackageVersionsResponse> {
		const { packument, error, found } = await this.#providers.packument(pkg);
		if (error || !found) return { error, found };

		// Extract version keys from packument
		const versions = packument && typeof packument.versions === 'object' ? Object.keys(packument.versions) : [];
		return { versions };
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @param version - The specific version to retrieve.
	 */
	async manifest(pkg: string, specifier: string, version: string): Promise<IPackageManifestResponse> {
		const { error, found, manifest } = await this.#providers.manifest(pkg, specifier, version);
		return { error, found, manifest };
	}

	/**
	 * Builds a download URL for a package given its scope and name.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @returns The download URL for the package.
	 */
	tarball(pkg: string, specifier: string, version: string): { url: string; headers: Record<string, string> } {
		return this.#providers.tarball(pkg, specifier, version);
	}
}
