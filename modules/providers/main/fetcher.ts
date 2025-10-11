import type { IPackument, IPackageManifest, IDiagnostic } from '@beyond-js/packages/types';
import type { IPackageManifestResponse, IPackumentResponse } from '@beyond-js/packages/providers/types';

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
			const error: IDiagnostic = { code: 'NETWORK_ERROR', message: 'Network error occurred' };
			return { error };
		}

		const { ok, status } = response;

		// Package not found
		if (status === 404) {
			return { found: false };
		}

		// Any non-200 and non-404 response
		if (!ok) {
			const code = 'INVALID_PROVIDER_RESPONSE';
			const message = `Invalid response from provider: ${status}`;
			return { error: { code, message } };
		}

		try {
			const manifest: IPackageManifest = await response.json();
			return { manifest, found: true };
		} catch (exc) {
			// Response was 200 OK, but the JSON could not be parsed
			const code = 'PROVIDER_RESPONSE_NOT_PARSABLE';
			const message = 'The provider response could not be parsed as JSON';
			return { error: { code, message } };
		}
	}

	/**
	 * Fetch the packument for a package.
	 */
	static async packument(rq: IFetchRq): Promise<IPackumentResponse> {
		// Fetch the packument in abbreviated format (less payload)
		const headers = { ...(rq.headers ?? {}), Accept: 'application/vnd.npm.install-v1+json' };

		const { url } = rq;
		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			const code = 'NETWORK_ERROR';
			const message = 'Network error occurred';
			return { error: { code, message } };
		}

		const { ok, status } = response;

		if (status === 404) {
			return { found: false };
		}

		if (!ok) {
			const code = 'INVALID_PROVIDER_RESPONSE';
			const message = `Invalid response from provider: ${status}`;
			return { error: { code, message } };
		}

		try {
			const packument: IPackument = await response.json();
			console.log('Packument', packument);
			return { packument, found: true };
		} catch (exc) {
			const code = 'PROVIDER_RESPONSE_NOT_PARSABLE';
			const message = 'The provider response could not be parsed as JSON';
			return { error: { code, message } };
		}
	}
}
