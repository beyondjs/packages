import type { IPackageManifest, IPackument, IDiagnostic } from '@beyond-js/packages/types';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';
import type { DependencySource } from '@beyond-js/packages/dependency-source';

export /*bundle*/ interface IProvidersOptions extends IProvidersSettingsOptions {}

export /*bundle*/ interface ICacheOptions {
	etag?: string;
	lastModified?: string;
}

export /*bundle*/ interface IPackageResponseBase {
	error?: IDiagnostic;
	found?: boolean;
	notmodified?: boolean;
	cache?: ICacheOptions;
}

export /*bundle*/ interface IPackumentResponse extends IPackageResponseBase {
	packument?: IPackument;
}

export /*bundle*/ interface IPackageVersionsResponse extends IPackageResponseBase {
	versions?: string[];
}

/**
 * Who served a release and whether it is public. It never carries the credentials.
 */
export /*bundle*/ interface IProviderIdentity {
	// Identity of the registry or host: `host[:port][/prefix]`
	registry: string;
	// Normalized base address (scheme, host, port, prefix). It never carries credentials
	base?: string;
	// `public` when the release is served without credentials; `private` otherwise, and on any doubt
	visibility: 'public' | 'private';
	// Only for a release read with a credential: `anonymous` when an anonymous probe established that the
	// same release is public (it is then fetched without the credential), `credential` when it stays private
	access?: 'anonymous' | 'credential';
}

export /*bundle*/ interface IPackageArchiveResponse {
	error?: IDiagnostic;
	// `sha512-<base64>` of the archive as it was downloaded
	integrity?: string;
	bytes?: number;
}

export /*bundle*/ interface IPackageManifestResponse extends IPackageResponseBase {
	manifest?: IPackageManifest;
	// The document the manifest was read from: the package metadata, or a dedicated manifest request
	via?: 'packument' | 'manifest';
	provider?: IProviderIdentity;
}

export /*bundle*/ interface IPackageCommitResponse {
	error?: IDiagnostic;
	commit?: string;
}

export /*bundle*/ interface IPackageTarballResponse {
	error?: IDiagnostic;
	id?: string;
	path?: string;
	// The archive URL published by the provider for this exact release (`dist.tarball`)
	url?: string;
	// Request headers. They may carry credentials: never log, persist or return them to a client
	headers?: Record<string, string>;
	integrity?: string;
	shasum?: string;
	provider?: IProviderIdentity;
}

/**
 * Durable storage of package metadata. Keys are opaque and already carry the provider, the package, the
 * release and the tenant or credential scope: an implementation must not reinterpret or shorten them.
 */
export /*bundle*/ interface IMetadataStore {
	get(key: string): Promise<IMetadataRecord | undefined | void>;
	set(key: string, record: IMetadataRecord): Promise<void>;
}

export /*bundle*/ interface IMetadataRecord {
	// `public` or the private scope the record belongs to
	scope: string;
	document: any;
	cache?: ICacheOptions;
}

export /*bundle*/ interface IPackageProviders {
	/**
	 * Retrieves the package metadata document (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 */
	packument?(pkg: string, cache?: ICacheOptions): Promise<IPackumentResponse>;

	/**
	 * Retrieves the available versions for a package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 */
	versions?(pkg: string, cache?: ICacheOptions): Promise<IPackageVersionsResponse>;

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	manifest(source: DependencySource, release: string, cache?: ICacheOptions): Promise<IPackageManifestResponse>;

	/**
	 * Identity and visibility of the provider that serves a source
	 */
	describe?(source: DependencySource): Promise<IProviderIdentity>;

	/**
	 * Pins the reference of a git source to a commit, asking the provider when it is not already one
	 */
	commit?(source: DependencySource): Promise<IPackageCommitResponse>;

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	tarball(source: DependencySource, release: string): Promise<IPackageTarballResponse>;

	/**
	 * Downloads an archive URL once and answers its `sha512` integrity: how an archive URL that declares no
	 * integrity is pinned
	 */
	archive?(source: DependencySource): Promise<IPackageArchiveResponse>;
}
