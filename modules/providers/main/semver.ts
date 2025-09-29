import type {
	IProvider,
	IPackageVersionsResponse,
	IPackumentResponse,
	IPackageManifestResponse
} from '@beyond-js/packages/providers/types';
import type { IProviderAuthData } from '@beyond-js/packages/providers/settings/types';
import type { DependencyInfo, ISemverDependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import { PackageRegistryFetcher } from './fetcher';
import { AuthHeaders } from './tools';

/**
 * Registry adapter for semver-based dependencies resolved against npm-compatible registries.
 */
export class SemverRegistry implements IProvider {
	readonly #name = 'semver';
	get name(): string {
		return this.#name;
	}

	/** Build headers for a given host (auth if present). */
	#headers(dependency: DependencyInfo): Record<string, string> {
		const data = <ISemverDependencyInfo>dependency.data;
		const { auth } = data.provider;
		return auth ? AuthHeaders.process(auth) : {};
	}

	async versions(dependency: DependencyInfo): Promise<IPackageVersionsResponse> {
		const { packument, error, found } = await this.packument(dependency);
		if (error || !found) return { error, found };

		// Extract version keys from packument
		const versions = packument && typeof packument.versions === 'object' ? Object.keys(packument.versions) : [];
		return { versions };
	}

	async packument?(dependency: DependencyInfo): Promise<IPackumentResponse> {
		const { package: pkg } = dependency;
		const data = <ISemverDependencyInfo>dependency.data;
		const { hostname } = data.provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}`;
		const headers = this.#headers(dependency);
		return await PackageRegistryFetcher.packument({ url, headers });
	}

	/**
	 * Fetch package spec (metadata / package.json) for a concrete version or dist-tag.
	 * Examples for `version`: "1.2.3", "latest", "beta" (NO ranges).
	 */
	async manifest(dependency: DependencyInfo, version: string): Promise<IPackageManifestResponse> {
		const { package: pkg } = dependency;
		const data = <ISemverDependencyInfo>dependency.data;
		const { hostname } = data.provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`;
		const headers = this.#headers(dependency);
		return await PackageRegistryFetcher.manifest({ url, headers });
	}

	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> } {
		const { package: pkg, name } = dependency;
		const data = <ISemverDependencyInfo>dependency.data;
		const { hostname } = data.provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}/-/${name}.tgz`;
		const headers = this.#headers(dependency);
		return { url, headers };
	}
}
