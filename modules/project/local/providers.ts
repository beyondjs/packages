import type { Project } from './';
import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IPackageVersionsResponse, IPackageManifestResponse } from '@beyond-js/packages/providers/types';
import type { IPackageData } from '@beyond-js/packages/persistence/types';
import { PackageProviders as PackageProvidersBase } from '@beyond-js/packages/providers';
import { db } from '@beyond-js/packages/persistence/db';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';

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
		if (!pkg) throw new Error('Package parameter is required');

		await this.#providers.ready;
		const source = new DependencySource(pkg, '0.0.0');
		const { provider } = new DependencySourceProvider(source, this.#providers.settings);

		const { packument, error, found } = await this.#providers.packument(pkg);
		if (error || !found) return { error, found };

		// Extract version keys from packument
		const versions = packument && typeof packument.versions === 'object' ? Object.keys(packument.versions) : [];

		const { id } = source;
		const { auth } = provider;
		const data: IPackageData = { id, public: auth.mode === 'none', versions };

		db.packages.set({ id, data });
		return { versions };
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	async manifest(source: DependencySource, release: string): Promise<IPackageManifestResponse> {
		const { error, found, manifest } = await this.#providers.manifest(source, release);
		return { error, found, manifest };
	}

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version (only for semver)
	 */
	tarball(source: DependencySource, release?: string): { url: string; headers: Record<string, string> } {
		return this.#providers.tarball(source, release);
	}
}
