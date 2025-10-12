import type {
	IPackumentResponse,
	IPackageManifestResponse,
	IPackageProvider
} from '@beyond-js/packages/providers/types';
import type { DependencyInfo } from '@beyond-js/packages/providers/parser/info';
import type { ISemverDependencyData } from '@beyond-js/packages/providers/parser';
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

	/** Build headers for a given host (auth if present). */
	#headers(dependency: DependencyInfo): Record<string, string> {
		const data = <ISemverDependencyData>dependency.data;
		const { auth } = dependency.provider;
		return auth.mode !== 'none' ? AuthHeaders.process(auth) : {};
	}

	async packument?(dependency: DependencyInfo): Promise<IPackumentResponse> {
		const { package: pkg } = dependency;
		const data = <ISemverDependencyData>dependency.data;
		const { hostname } = dependency.provider;

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
		const data = <ISemverDependencyData>dependency.data;
		const { hostname } = dependency.provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`;
		const headers = this.#headers(dependency);
		return await PackageRegistryFetcher.manifest({ url, headers });
	}

	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> } {
		const { package: pkg, name } = dependency;
		const data = <ISemverDependencyData>dependency.data;
		const { hostname } = dependency.provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}/-/${name}.tgz`;
		const headers = this.#headers(dependency);
		return { url, headers };
	}
}
