import type {
	IPackumentResponse,
	IPackageManifestResponse,
	IPackageProvider,
	ICacheOptions
} from '@beyond-js/packages/providers/types';
import type { IDist } from '@beyond-js/packages/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { Endpoint } from '@beyond-js/packages/providers/settings';
import { type Transport, PackageRegistryFetcher } from './fetcher';
import { type ITarballRequest, AuthHeaders } from './tools';

/**
 * Registry adapter for semver-based dependencies resolved against npm-compatible registries.
 * Every request is built from the normalized base of the provider (scheme, host, port, path prefix).
 */
export class SemverRegistry implements IPackageProvider {
	readonly #name = 'semver';
	get name(): string {
		return this.#name;
	}

	#transport?: Transport;

	constructor(transport?: Transport) {
		this.#transport = transport;
	}

	/**
	 * The path segment of a package: the scope separator is the only character registries need encoded
	 */
	#segment(pkg: string): string {
		return pkg.split('/').map(encodeURIComponent).join('%2F').replace(/^%40/, '@');
	}

	async packument(dependency: DependencySourceProvider, cache?: ICacheOptions): Promise<IPackumentResponse> {
		const { source, provider } = dependency;
		if (source.data.is !== DependencySourceIsType.Semver) {
			throw new Error('Packument can only be fetched on semver repository sources');
		}

		const url = new Endpoint(provider.base).url(this.#segment(source.package));

		// Fetch the packument in abbreviated format (less payload)
		const headers = AuthHeaders.process(provider.auth);
		headers['Accept'] = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8';

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache, transport: this.#transport });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, packument: r.document, cache: r.cache };
	}

	async manifest(dependency: DependencySourceRelease, cache?: ICacheOptions): Promise<IPackageManifestResponse> {
		const { source, provider, release } = dependency;
		if (source.data.is !== DependencySourceIsType.Semver) {
			throw new Error(`Source type "${source.data.is}" is not currently supported`);
		}

		const url = new Endpoint(provider.base).url(this.#segment(source.package), encodeURIComponent(release));
		const headers = AuthHeaders.process(provider.auth);

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache, transport: this.#transport });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, manifest: r.document, cache: r.cache };
	}

	/**
	 * Whether a release that was read with a credential is also public: the registry answers its package document
	 * without the credential, that document holds the release with the same `dist.integrity` (or `shasum`) and
	 * archive URL, and the archive itself is answered without the credential. No request carries a credential,
	 * and any doubt answers false: a registry cannot tell "not found" from "not allowed" to an anonymous client.
	 *
	 * @param dist The distribution metadata read with the credential
	 */
	async probe(dependency: DependencySourceRelease, dist?: IDist): Promise<boolean> {
		const { source, provider, release } = dependency;
		if (source.data.is !== DependencySourceIsType.Semver || !dist?.tarball) return false;

		const endpoint = new Endpoint(provider.base);
		const segment = this.#segment(source.package);
		const Accept = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8';
		const packument = await PackageRegistryFetcher.fetch({ url: endpoint.url(segment), headers: { Accept }, transport: this.#transport });
		if (packument.error || !packument.found) return false;

		let manifest = packument.document?.versions?.[release];
		if (!manifest || typeof manifest !== 'object') {
			const url = endpoint.url(segment, encodeURIComponent(release));
			const answer = await PackageRegistryFetcher.fetch({ url, transport: this.#transport });
			if (answer.error || !answer.found) return false;
			manifest = answer.document;
		}

		const anonymous = manifest?.dist;
		const same = dist.integrity ? anonymous?.integrity === dist.integrity : !!dist.shasum && anonymous?.shasum === dist.shasum;
		if (!same || anonymous?.tarball !== dist.tarball) return false;

		// The archive: its status is enough, and the transfer stops as soon as it is known
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 30_000);
		try {
			const response = await (this.#transport || fetch)(dist.tarball, { signal: abort.signal });
			const ok = response.ok;
			await response.body?.cancel().catch((): void => {});
			return ok;
		} catch {
			return false;
		} finally {
			abort.abort();
			clearTimeout(timer);
		}
	}

	/**
	 * The download request of a release: the archive the registry published in the metadata of that
	 * release. The URL is never synthesized from the package name.
	 */
	async tarball(dependency: DependencySourceRelease, dist?: IDist): Promise<ITarballRequest> {
		const { source, provider, release } = dependency;

		if (!dist?.tarball || !/^https?:\/\//.test(dist.tarball)) {
			const code = 'TARBALL_UNAVAILABLE';
			const message = `The registry does not publish an archive for "${source.package}@${release}"`;
			return { error: { code, message } };
		}

		return { url: dist.tarball, headers: AuthHeaders.within(provider, dist.tarball) };
	}
}
