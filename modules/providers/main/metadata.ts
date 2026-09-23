import type {
	IPackageProviders,
	IPackageVersionsResponse,
	IPackageManifestResponse,
	IPackageTarballResponse,
	IPackageCommitResponse,
	IPackumentResponse,
	IPackageArchiveResponse,
	IProviderIdentity,
	IMetadataStore
} from '@beyond-js/packages/providers/types';
import type { IPackageManifest } from '@beyond-js/packages/types';
import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import type { PackageProviders } from './';
import { DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import { MemoryMetadataStore } from './store';
import { createHash } from 'crypto';

export /*bundle*/ interface IMetadataOptions {
	// Durable storage of documents. Defaults to memory
	store?: IMetadataStore;
	// The tenant (organization) the requests are made for. Private records are scoped to it
	tenant?: string;
}

/**
 * Package metadata with caching: what the dependency graph asks versions and manifests to.
 *
 * - A record is keyed by scope, document kind, provider identity, package and release. The scope is
 *   `public` for anonymous providers and the tenant (or, without one, a digest of the credentials) for
 *   authenticated ones, so a private record is never served to another tenant or credential.
 * - Writes are awaited, and concurrent requests of one document share a single fetch.
 * - Release manifests are read from the package metadata; a provider that does not publish them there
 *   requires a manifest request, which is reported in `exceptions`.
 * - Visibility belongs to each release, not to the credential: a registry release read with a credential is
 *   public only when an anonymous probe finds the same release and its archive (`PackageProviders.probe`);
 *   otherwise, and on any doubt, it is private. A release read without a credential is public.
 */
export /*bundle*/ class Metadata implements IPackageProviders {
	#providers: PackageProviders;
	#store: IMetadataStore;
	#tenant?: string;
	#flights: Map<string, Promise<any>> = new Map();

	#exceptions: Map<string, { registry: string; package: string; release: string }> = new Map();
	/**
	 * Releases whose manifest required its own request because the provider has no package metadata
	 */
	get exceptions() {
		return [...this.#exceptions.values()];
	}

	get providers() {
		return this.#providers;
	}

	constructor(providers: PackageProviders, options: IMetadataOptions = {}) {
		this.#providers = providers;
		this.#store = options.store || new MemoryMetadataStore();
		this.#tenant = options.tenant;
	}

	/**
	 * The storage scope of what a provider serves
	 */
	#scope(provider: IProviderData): string {
		if (!provider.auth || provider.auth.mode === 'none') return 'public';
		if (this.#tenant) return `org:${this.#tenant}`;

		const { mode, user, token } = provider.auth;
		const digest = createHash('sha256')
			.update(`${mode}\n${user || ''}\n${token || ''}`)
			.digest('hex');
		return `credential:${digest.slice(0, 24)}`;
	}

	#identity(provider: IProviderData): IProviderIdentity {
		const registry = provider.registry || provider.hostname;
		if (this.#scope(provider) === 'public') return { registry, base: provider.base, visibility: 'public' };
		return { registry, base: provider.base, visibility: 'private', access: 'credential' };
	}

	/**
	 * The identity of one registry release: a release read with a credential is public when the anonymous probe
	 * finds it, and is then fetched without the credential
	 */
	async #release(source: DependencySource, release: string, manifest: IPackageManifest, provider: IProviderIdentity) {
		if (provider.visibility === 'public' || source.data.is !== DependencySourceIsType.Semver) return provider;

		const key = ['probe', provider.registry, source.package, release].join('|');
		const open = await this.#once(key, () => this.#providers.probe(source, release, manifest?.dist));
		return open ? { ...provider, visibility: <const>'public', access: <const>'anonymous' } : provider;
	}

	/**
	 * Runs one fetch per key at a time and keeps its outcome for the life of this instance
	 */
	#once<T>(key: string, fn: () => Promise<T>): Promise<T> {
		if (this.#flights.has(key)) return this.#flights.get(key);
		const flight = fn();
		this.#flights.set(key, flight);
		return flight;
	}

	async #provider(source: DependencySource): Promise<IProviderData> {
		await this.#providers.ready;
		return new DependencySourceProvider(source, this.#providers.settings).provider;
	}

	/**
	 * Identity and visibility of the provider that serves a source
	 */
	async describe(source: DependencySource): Promise<IProviderIdentity> {
		return this.#identity(await this.#provider(source));
	}

	async packument(pkg: string): Promise<IPackumentResponse> {
		const provider = await this.#provider(new DependencySource(pkg, '0.0.0'));
		const scope = this.#scope(provider);
		const key = [scope, 'packument', provider.registry, pkg].join('|');

		return this.#once(key, async () => {
			const cached = (await this.#store.get(key)) || void 0;
			const response = await this.#providers.packument(pkg, cached?.cache);
			if (response.notmodified && cached) return { found: true, packument: cached.document };
			if (response.error || !response.found) return { error: response.error, found: response.found };

			await this.#store.set(key, { scope, document: response.packument, cache: response.cache });
			return { found: true, packument: response.packument };
		});
	}

	async versions(pkg: string): Promise<IPackageVersionsResponse> {
		if (!pkg) throw new Error('Package parameter is required');

		const { error, found, packument } = await this.packument(pkg);
		if (error || !found) return { error, found };

		const versions = packument && typeof packument.versions === 'object' ? Object.keys(packument.versions) : [];
		return { found: true, versions };
	}

	async manifest(source: DependencySource, release: string): Promise<IPackageManifestResponse> {
		source = source.target;
		const data = await this.#provider(source);
		const provider = this.#identity(data);

		if (source.data.is === DependencySourceIsType.Semver) {
			const { error, found, packument } = await this.packument(source.package);
			if (error || !found) return { error, found, provider };

			const manifest = packument.versions?.[release];
			if (manifest && typeof manifest === 'object') {
				return { found: true, manifest, via: 'packument', provider: await this.#release(source, release, manifest, provider) };
			}
		}

		const scope = this.#scope(data);
		const key = [scope, 'manifest', provider.registry, source.id, release].join('|');

		return this.#once(key, async () => {
			const cached = (await this.#store.get(key)) || void 0;
			const response = await this.#providers.manifest(source, release, cached?.cache);

			const exception = { registry: provider.registry, package: source.package, release };
			if (response.notmodified && cached) {
				this.#exceptions.set(key, exception);
				const identity = await this.#release(source, release, cached.document, provider);
				return { found: true, manifest: cached.document, via: 'manifest', provider: identity };
			}
			if (response.error || !response.found) return { error: response.error, found: response.found, provider };

			this.#exceptions.set(key, exception);
			await this.#store.set(key, { scope, document: response.manifest, cache: response.cache });
			const identity = await this.#release(source, release, response.manifest, provider);
			return { found: true, manifest: response.manifest, via: 'manifest', provider: identity };
		});
	}

	async commit(source: DependencySource): Promise<IPackageCommitResponse> {
		await this.#providers.ready;
		return this.#once(`commit|${source.id}`, () => this.#providers.commit(source));
	}

	/**
	 * The `sha512` integrity of an archive URL, downloaded once per instance
	 */
	async archive(source: DependencySource): Promise<IPackageArchiveResponse> {
		await this.#providers.ready;
		return this.#once(`archive|${source.id}`, () => this.#providers.archive(source));
	}

	/**
	 * The download request of a release, built from the archive URL and integrity its metadata publishes
	 */
	async tarball(source: DependencySource, release: string): Promise<IPackageTarballResponse> {
		source = source.target;
		const { error, found, manifest, provider } = await this.manifest(source, release);
		if (error) return { error, provider };
		if (!found) {
			const code = 'RELEASE_NOT_FOUND';
			return { error: { code, message: `Release "${source.package}@${release}" was not found` }, provider };
		}

		const response = await this.#providers.tarball(source, release, manifest.dist);
		return { ...response, provider };
	}
}
