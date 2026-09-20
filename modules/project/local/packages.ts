import type { Project } from './';
import type {
	IPackageProviders,
	IPackageVersionsResponse,
	IPackageManifestResponse,
	IPackageTarballResponse,
	IPackageCommitResponse,
	IProviderIdentity
} from '@beyond-js/packages/providers/types';
import type { DependencySource } from '@beyond-js/packages/dependency-source';
import { PackageProviders as PackageProvidersBase, Metadata } from '@beyond-js/packages/providers';
import { DatabaseMetadataStore } from './store';

/**
 * The package metadata of a local project: the providers configured for its package and workspace, with
 * the cache of the local database. Records are keyed by provider, package, release and credential
 * scope, their writes are awaited and concurrent requests of one document share one fetch (`Metadata`).
 */
export class PackageProviders implements IPackageProviders {
	#providers: PackageProvidersBase;
	get providers() {
		return this.#providers;
	}

	#metadata: Metadata;

	constructor(project: Project) {
		const { workspace, package: pkg } = project;
		this.#providers = new PackageProvidersBase({ workspace: workspace.path, path: pkg.path });
		this.#metadata = new Metadata(this.#providers, { store: new DatabaseMetadataStore() });
	}

	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 */
	versions(pkg: string): Promise<IPackageVersionsResponse> {
		return this.#metadata.versions(pkg);
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	manifest(source: DependencySource, release: string): Promise<IPackageManifestResponse> {
		return this.#metadata.manifest(source, release);
	}

	describe(source: DependencySource): Promise<IProviderIdentity> {
		return this.#metadata.describe(source);
	}

	commit(source: DependencySource): Promise<IPackageCommitResponse> {
		return this.#metadata.commit(source);
	}

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version (only for semver)
	 */
	tarball(source: DependencySource, release?: string): Promise<IPackageTarballResponse> {
		return this.#metadata.tarball(source, release);
	}
}
