import type { IPackument, IPackageManifest } from '@beyond-js/packages/types';
import type { IPackageManifestResponse, IPackumentResponse } from '@beyond-js/packages/providers/types';
import { InvalidProviderResponse, ProviderResponseCouldNotBeParsed } from '@beyond-js/packages/providers/errors';

interface IFetchRq {
	url: string;
	headers?: Record<string, string>;
}

export /*bundle*/ class PackageRegistryFetcher {
	/**
	 * Fetch manifest (package.json) for a specific version of a package.
	 */
	static async manifest({ url, headers }: IFetchRq): Promise<IPackageManifestResponse> {
		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			// Network or request-level error
			const error = new InvalidProviderResponse(0);
			return { error };
		}

		const { ok, status } = response;

		// Package not found
		if (status === 404) {
			return { found: false };
		}

		// Any non-200 and non-404 response
		if (!ok) {
			const error = new InvalidProviderResponse(status);
			return { error };
		}

		try {
			const manifest: IPackageManifest = await response.json();
			return { manifest, found: true };
		} catch (exc) {
			// Response was 200 OK, but the JSON could not be parsed
			const error = new ProviderResponseCouldNotBeParsed();
			return { error };
		}
	}

	/**
	 * Fetch the packument for a package (abbreviated or full).
	 *
	 * - When `abbreviated` is true, sends Accept: application/vnd.npm.install-v1+json to reduce payload size.
	 */
	static async packument(rq: IFetchRq, abbreviated: boolean): Promise<IPackumentResponse> {
		const base = rq.headers ?? {};
		const headers = abbreviated ? { ...base, Accept: 'application/vnd.npm.install-v1+json' } : base;

		const { url } = rq;
		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			const error = new InvalidProviderResponse(0);
			return { error };
		}

		const { ok, status } = response;

		if (status === 404) {
			return { found: false };
		}

		if (!ok) {
			const error = new InvalidProviderResponse(status);
			return { error };
		}

		try {
			const packument: IPackument = await response.json();
			return { packument, found: true };
		} catch (exc) {
			const error = new ProviderResponseCouldNotBeParsed();
			return { error };
		}
	}
}
