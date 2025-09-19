import type {
	IProvider,
	IPackageVersionsResponse,
	IPackumentResponse,
	IPackageManifestResponse,
	IProviderAuth
} from '@beyond-js/packages/providers/types';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import type { DependencyInfo } from '@beyond-js/packages/dependencies/info';
import { PackageRegistryFetcher } from './fetcher';
import { Cli } from './cil';
import { AuthHeaders } from './tools';

/**
 * Registry adapter for semver-based dependencies resolved against npm-compatible registries.
 */
export class SemverRegistry implements IProvider {
	#settings: ProvidersSettings;

	readonly #name = 'semver';
	get name(): string {
		return this.#name;
	}

	constructor(settings: ProvidersSettings) {
		this.#settings = settings;
	}

	/** Resolve host/auth for given (optional) scope; fallback to default. */
	#host(scope?: string): { host: string; auth?: IProviderAuth } {
		const def = this.#settings.default?.host ?? 'registry.npmjs.org';
		const host = scope ? this.#settings.scopes.get(scope) ?? def : def;
		const auth = this.#settings.hosts.get(host) ?? this.#settings.default?.auth;
		return { host, auth };
	}

	/** Build headers from auth (if any). */
	#headers(auth?: IProviderAuth, extra: Record<string, string> = {}): Record<string, string> {
		const base = auth ? AuthHeaders.process(auth) : {};
		return { ...base, ...extra };
	}

	async versions(pkg: string): Promise<IPackageVersionsResponse> {
		const scope = pkg.startsWith('@') ? pkg.split('/')[0] : void 0;
		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);

		// Use CLI for npmjs.org
		if (host === 'registry.npmjs.org') {
			const { versions, error } = await Cli.versions(pkg);
			if (!error) return { versions };
			// fallback to API on CLI failure
		}

		// Use API (abbreviated packument) to avoid heavy payloads
		const { packument, error, found } = await this.packument(pkg, true);
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
		return await PackageRegistryFetcher.packument({ url, headers }, abbreviated);
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
