import type { IProvider, IPackageManifestResponse } from './types';
import type { IRepositoryAuth } from '@beyond-js/packages/providers/types';
import type { Logger } from '@beyond-js/packages/logs';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { PackageRegistryFetcher } from './fetcher';
import { Cli } from './cil';
import { ErrorGettingPackageVersions } from '@beyond-js/packages/providers/errors';
import { ProvidersResponse } from '@beyond-js/packages/providers/response';
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
	#host(scope?: string): { host: string; auth?: IRepositoryAuth } {
		const def = this.#settings.default?.host ?? 'registry.npmjs.org';
		const host = scope ? this.#settings.scopes.get(scope) ?? def : def;
		const auth = this.#settings.hosts.get(host) ?? this.#settings.default?.auth;
		return { host, auth };
	}

	/** Build headers from auth (if any). */
	#headers(auth?: IRepositoryAuth, extra: Record<string, string> = {}): Record<string, string> {
		const base = auth ? AuthHeaders.process(auth) : {};
		return { ...base, ...extra };
	}

	tarball(name: string): { url: string; headers: Record<string, string> } {
		const fullname = name;
		const scope = name.startsWith('@') ? name.split('/')[0] : void 0;
		name = name.startsWith('@') ? name.split('/')[1] : name;

		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);
		const url = `https://${host}/${encodeURIComponent(fullname)}/-/${name}.tgz`;
		return { url, headers };
	}

	async versions(name: string, logger?: Logger): Promise<ProvidersResponse<string[]>> {
		const scope = name.startsWith('@') ? name.split('/')[0] : void 0;

		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);

		if (host === 'registry.npmjs.org') {
			const response = await Cli.versions(name, logger);
			if (!response.error) return response;
			// fallback to API on CLI failure
		}

		// Use API (abbreviated packument) to avoid heavy payloads
		const response = await PackageRegistryFetcher.specs({ host, headers, logger }, name, true);

		// Error from fetcher → bubble up
		if (response.error) return new ProvidersResponse({ error: response.error });

		// Not found or invalid → empty list
		if (!response.found || response.valid === false || !response.value) {
			return new ProvidersResponse({ data: [] });
		}

		// Extract version keys from packument
		const packument = response.value;
		const versions = packument && typeof packument.versions === 'object' ? Object.keys(packument.versions) : [];

		return new ProvidersResponse({ data: versions });
	}

	/**
	 * Fetch package spec (metadata / package.json) for a concrete version or dist-tag.
	 * Examples for `version`: "1.2.3", "latest", "beta" (NO ranges).
	 */
	async spec(
		name: string,
		version: string,
		scope?: string,
		abbreviated = false,
		logger?: Logger
	): Promise<ProvidersResponse<IPackageManifestResponse>> {
		const { host, auth } = this.#host(scope);
		const headers = this.#headers(auth);

		const response = await PackageRegistryFetcher.spec({ host, headers, logger }, name, scope);

		if (response.error) {
			return new ProvidersResponse({ error: response.error });
		} else {
			return new ProvidersResponse({ data: response });
		}
	}
}
