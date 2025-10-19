import type {
	IPackumentResponse,
	IPackageManifestResponse,
	IPackageProvider,
	ICacheOptions
} from '@beyond-js/packages/providers/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { PackageRegistryFetcher } from './fetcher';
import { AuthHeaders } from './tools';

/**
 * Registry adapter for semver-based dependencies resolved against npm-compatible registries.
 */
export class SemverRegistry implements IPackageProvider {
	readonly #name = 'semver';
	get name(): string {
		return this.#name;
	}

	async packument(dependency: DependencySourceProvider, cache: ICacheOptions): Promise<IPackumentResponse> {
		const { source, provider } = dependency;
		const { package: pkg } = source;
		if (dependency.source.data.is !== DependencySourceIsType.Semver) {
			throw new Error('Packument can only be fetched on semver repository sources');
		}

		const { hostname } = provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}`;

		// Prepare headers
		const headers = AuthHeaders.process(provider.auth);

		// Fetch the packument in abbreviated format (less payload)
		headers['Accept'] = 'application/vnd.npm.install-v1+json';

		// Set cache headers
		if (cache) {
			headers['If-None-Match'] = cache.etag;
			headers['If-Modified-Since'] = cache.lastModified;
		}

		const r = await PackageRegistryFetcher.fetch({ url, headers });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, packument: r.document, cache: r.cache };
	}

	async manifest(dependency: DependencySourceRelease, cache: ICacheOptions): Promise<IPackageManifestResponse> {
		const { source, provider, release } = dependency;
		const { package: pkg } = source;
		const { is } = source.data;
		const { hostname } = provider;

		// Prepare headers
		const headers = AuthHeaders.process(provider.auth);

		// Set cache headers
		if (cache) {
			headers['If-None-Match'] = cache.etag;
			headers['If-Modified-Since'] = cache.lastModified;
		}

		let url: string;
		if (source.data.is === DependencySourceIsType.Semver) {
			url = `https://${hostname}/${encodeURIComponent(pkg)}/${encodeURIComponent(release)}`;
		} else {
			throw new Error(`Source type "${is}" is not currently supported`);
		}

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, manifest: r.document, cache: r.cache };
	}

	tarball(dependency: DependencySourceProvider, release: string): { url: string; headers: Record<string, string> } {
		const { package: pkg, name } = dependency.source;
		const { source, provider } = dependency;
		const { is } = source.data;
		const { hostname } = provider;
		const headers = AuthHeaders.process(provider.auth);

		let url: string;

		if (source.data.is === DependencySourceIsType.Semver) {
			url = `https://${hostname}/${encodeURIComponent(pkg)}/-/${name}.tgz`;
		} else {
			throw new Error(`Source type "${is}" is not currently supported`);
		}

		return { url, headers };
	}
}
