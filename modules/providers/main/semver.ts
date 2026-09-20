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
import { PackageRegistryFetcher } from './fetcher';
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

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache });
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

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, manifest: r.document, cache: r.cache };
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
