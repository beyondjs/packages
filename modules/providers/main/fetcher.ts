import type { ICacheOptions, IPackageResponseBase } from '@beyond-js/packages/providers/types';

export /*bundle*/ interface IFetchRq {
	url: string;
	headers?: Record<string, string>;
	cache?: ICacheOptions;
}

export /*bundle*/ interface IDocumentResponse extends IPackageResponseBase {
	document?: any;
}

export /*bundle*/ class PackageRegistryFetcher {
	/**
	 * Fetch registry document (package.json manifest or packument)
	 */
	static async fetch(rq: IFetchRq): Promise<IDocumentResponse> {
		const { url, headers } = rq;

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
		if (status === 304) {
			return { found: true, notmodified: true };
		}

		if (!ok) {
			const code = 'INVALID_PROVIDER_RESPONSE';
			const message = `Invalid response from provider: ${status}`;
			return { error: { code, message } };
		}

		try {
			const document = await response.json();
			const cache = {
				etag: response.headers.get('ETag') || undefined,
				lastModified: response.headers.get('Last-Modified') || undefined
			};

			return { document, found: true, cache };
		} catch (exc) {
			const code = 'PROVIDER_RESPONSE_NOT_PARSABLE';
			const message = 'The provider response could not be parsed as JSON';
			return { error: { code, message } };
		}
	}
}
