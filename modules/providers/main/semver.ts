import type {
	IProvider,
	IPackageVersionsResponse,
	IPackumentResponse,
	IPackageManifestResponse
} from '@beyond-js/packages/providers/types';
import type { IProviderAuthData } from '@beyond-js/packages/providers/settings/types';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import type { DependencyInfo } from '@beyond-js/packages/dependencies/info';
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

	/** Build headers from auth (if any). */
	#headers(auth?: IProviderAuthData, extra: Record<string, string> = {}): Record<string, string> {
		const base = auth ? AuthHeaders.process(auth) : {};
		return { ...base, ...extra };
	}

	async versions(pkg: string): Promise<IPackageVersionsResponse> {
		// Use API (abbreviated packument) to avoid heavy payloads
		const { packument, error, found } = await this.packument(pkg);
		if (error || !found) return { error, found };

		// Extract version keys from packument
		const versions = packument && typeof packument.versions === 'object' ? Object.keys(packument.versions) : [];
		return { versions };
	}

	async packument?(pkg: string, abbreviated?: boolean): Promise<IPackumentResponse> {
		const scope = pkg.startsWith('@') ? pkg.split('/')[0] : void 0;
		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);

		const url = `https://${host}/${encodeURIComponent(pkg)}`;
		return await PackageRegistryFetcher.packument({ url, headers });
	}

	/**
	 * Fetch package spec (metadata / package.json) for a concrete version or dist-tag.
	 * Examples for `version`: "1.2.3", "latest", "beta" (NO ranges).
	 */
	async manifest(dependency: DependencyInfo, version: string): Promise<IPackageManifestResponse> {
		const { package: pkg } = dependency;
		const scope = pkg.startsWith('@') ? pkg.split('/')[0] : void 0;
		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);

		const url = `https://${host}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`;
		return await PackageRegistryFetcher.manifest({ url, headers });
	}

	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> } {
		const { package: pkg } = dependency;
		const fullname = pkg;
		const scope = pkg.startsWith('@') ? pkg.split('/')[0] : void 0;
		const name = pkg.startsWith('@') ? pkg.split('/')[1] : pkg;

		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);
		const url = `https://${host}/${encodeURIComponent(fullname)}/-/${name}.tgz`;
		return { url, headers };
	}
}
