import type {
	IPackageManifestResponse,
	IPackageProvider,
	IPackageProviders,
	IPackumentResponse,
	IPackageTarballResponse,
	IPackageCommitResponse,
	IPackageArchiveResponse,
	ICacheOptions
} from '@beyond-js/packages/providers/types';
import type { IDist } from '@beyond-js/packages/types';
import { type IProvidersSettingsOptions, ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { SemverRegistry } from './semver';
import { GitProvider } from './git';
import { AuthHeaders } from './tools';
import type { Transport } from './fetcher';
import { type ForgeKind, Forges } from './forges';
import { Archives } from './archives';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export /*bundle*/ interface IProvidersOptions extends IProvidersSettingsOptions {
	// How every request reaches the network; the global `fetch` when absent. A consumer that must validate
	// destinations (a service that fetches for tenants) injects its own
	fetch?: Transport;
	// Git hosts of a known kind besides github.com, gitlab.com and bitbucket.org, by host (`gitlab.acme.example`)
	forges?: Record<string, ForgeKind>;
}

/**
 * Requests package metadata to the provider that serves each source (npm-compatible registries and git
 * hosts), with the settings and credentials that apply. It holds no cache: see `Metadata`.
 */
export /*bundle*/ class PackageProviders extends Map<string, IPackageProvider> implements IPackageProviders {
	#settings: ProvidersSettings;
	get settings() {
		return this.#settings;
	}

	#semver: SemverRegistry;
	#git: GitProvider;
	#archives: Archives;

	#transport?: Transport;
	/**
	 * The transport of every request, which a fetch of the sources uses as well; undefined for the global `fetch`
	 */
	get transport() {
		return this.#transport;
	}

	#initialized = false;
	get initialized() {
		return this.#initialized;
	}

	#error?: { code: string; message: string };
	/**
	 * Set when the settings could not be loaded. `ready` still resolves: requests then answer this error
	 */
	get error() {
		return this.#error;
	}

	/**
	 * Promise that resolves when the providers are ready to be used
	 * This is useful for ensuring that all provider settings are loaded before making requests.
	 */
	#ready: PendingPromise<void>;
	get ready() {
		return this.#ready;
	}

	constructor(options: IProvidersOptions) {
		super();

		this.#ready = new PendingPromise();
		this.#settings = new ProvidersSettings(options);
		this.#settings
			.load()
			.then(() => (this.#initialized = true))
			.catch(() => {
				// The cause is not reported: it may quote a settings file, which can hold credentials
				this.#error = { code: 'PROVIDER_SETTINGS_INVALID', message: 'The provider settings failed to load' };
			})
			.finally(() => this.#ready.resolve());

		this.#transport = options?.fetch;
		this.#semver = new SemverRegistry(this.#transport);
		this.#git = new GitProvider(this.#transport, new Forges(options?.forges));
		this.#archives = new Archives(this.#transport);

		this.set('semver', this.#semver);
		this.set('git', this.#git);
	}

	#unsupported(is: string) {
		const code = 'SOURCE_UNSUPPORTED';
		return { error: { code, message: `Dependency sources of type "${is}" are not supported by any provider` } };
	}

	/**
	 * Retrieves the packument for a specific package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 */
	async packument(pkg: string, cache?: ICacheOptions): Promise<IPackumentResponse> {
		// Wait until providers are ready (settings are loaded)
		await this.#ready;
		if (this.#error) return { error: this.#error };

		const source = new DependencySource(pkg, '0.0.0');
		const dependency = new DependencySourceProvider(source, this.#settings);
		return await this.#semver.packument(dependency, cache);
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param source - Package source specification
	 * @param release - Package release version, or the commit of a git source
	 */
	async manifest(
		source: DependencySource,
		release: string,
		cache?: ICacheOptions
	): Promise<IPackageManifestResponse> {
		await this.#ready;
		if (this.#error) return { error: this.#error };

		source = source.target;
		const { is } = source.data;
		if (is !== DependencySourceIsType.Semver && is !== DependencySourceIsType.Git) return this.#unsupported(is);

		const provider = new DependencySourceProvider(source, this.#settings);
		const dependency = new DependencySourceRelease(provider, release);
		return is === DependencySourceIsType.Semver
			? await this.#semver.manifest(dependency, cache)
			: await this.#git.manifest(dependency, cache);
	}

	/**
	 * Pins the reference of a git source to a commit
	 */
	async commit(source: DependencySource): Promise<IPackageCommitResponse> {
		await this.#ready;
		if (this.#error) return { error: this.#error };
		if (source.data.is !== DependencySourceIsType.Git) return this.#unsupported(source.data.is);

		return await this.#git.commit(new DependencySourceProvider(source, this.#settings));
	}

	/**
	 * Whether a registry release that was read with a credential is public as well (see `SemverRegistry.probe`)
	 *
	 * @param dist The distribution metadata of the release, as it was read with the credential
	 */
	async probe(source: DependencySource, release: string, dist?: IDist): Promise<boolean> {
		await this.#ready;
		if (this.#error) return false;

		source = source.target;
		if (source.data.is !== DependencySourceIsType.Semver) return false;
		const dependency = new DependencySourceRelease(new DependencySourceProvider(source, this.#settings), release);
		return await this.#semver.probe(dependency, dist);
	}

	/**
	 * Downloads an archive URL once and answers its `sha512` integrity, which pins a URL that declares none
	 */
	async archive(source: DependencySource): Promise<IPackageArchiveResponse> {
		await this.#ready;
		if (this.#error) return { error: this.#error };
		const { data } = source;
		if (data.is !== DependencySourceIsType.Url) return this.#unsupported(data.is);

		const { url } = data;
		const provider = new DependencySourceProvider(source, this.#settings).provider;
		return await this.#archives.digest(url, AuthHeaders.within(provider, url));
	}

	/**
	 * The request headers to download a URL that the provider of a package published. They carry the
	 * credentials of that provider only when the URL belongs to it, and those of a declared host when it
	 * belongs to that host; a URL elsewhere gets none. Never log, persist or return these headers.
	 */
	async authorize(pkg: string, url: string): Promise<Record<string, string>> {
		await this.#ready;
		if (this.#error) return {};

		const registry = AuthHeaders.within(this.#settings.get({ package: pkg }), url);
		if (Object.keys(registry).length) return registry;

		try {
			const { host, origin } = new URL(url);
			return AuthHeaders.within(this.#settings.get({ hostname: host, base: origin }), url);
		} catch {
			return {};
		}
	}

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version, or the commit of a git source
	 * @param dist - Distribution metadata of the release (required for registries)
	 */
	async tarball(source: DependencySource, release: string, dist?: IDist): Promise<IPackageTarballResponse> {
		await this.#ready;
		if (this.#error) return { error: this.#error };

		source = source.target;
		const { is } = source.data;
		if (is !== DependencySourceIsType.Semver && is !== DependencySourceIsType.Git) return this.#unsupported(is);

		const provider = new DependencySourceProvider(source, this.#settings);
		const dependency = new DependencySourceRelease(provider, release);
		const { id, path } = dependency;

		const request =
			is === DependencySourceIsType.Semver
				? await this.#semver.tarball(dependency, dist)
				: await this.#git.tarball(dependency);

		if (request.error) return { error: request.error };
		return {
			id,
			path,
			url: request.url,
			headers: request.headers,
			integrity: dist?.integrity,
			shasum: dist?.shasum
		};
	}
}
