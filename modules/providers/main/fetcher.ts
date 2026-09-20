import type { ICacheOptions, IPackageResponseBase } from '@beyond-js/packages/providers/types';

export /*bundle*/ interface IFetchRq {
	url: string;
	headers?: Record<string, string>;
	cache?: ICacheOptions;
	// Milliseconds before the request is abandoned
	timeout?: number;
	// Read the body as text instead of JSON (`document` is then a string)
	text?: boolean;
}

export /*bundle*/ interface IDocumentResponse extends IPackageResponseBase {
	document?: any;
}

/**
 * Requests a metadata document. Failures are returned as diagnostics whose messages never include the
 * request headers, because they may carry credentials.
 */
export /*bundle*/ class PackageRegistryFetcher {
	/**
	 * Fetch registry document (package.json manifest or packument)
	 */
	static async fetch(rq: IFetchRq): Promise<IDocumentResponse> {
		const { url, cache } = rq;
		const headers = { ...rq.headers };
		if (cache?.etag) headers['If-None-Match'] = cache.etag;
		if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified;

		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), rq.timeout || 30_000);

		try {
			let response: Response;
			try {
				response = await fetch(url, { headers, signal: abort.signal });
			} catch (exc) {
				const code = 'NETWORK_ERROR';
				const message = `The provider could not be reached: ${new URL(url).host}`;
				return { error: { code, message } };
			}

			const { ok, status } = response;
			if (status === 404) return { found: false };
			if (status === 304) return { found: true, notmodified: true };

			if (status === 401 || status === 403) {
				const code = status === 401 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_AUTH_DENIED';
				const message = `The provider ${new URL(url).host} refused the request with status ${status}`;
				return { error: { code, message } };
			}

			if (!ok) {
				const code = 'INVALID_PROVIDER_RESPONSE';
				const message = `Invalid response from provider: ${status}`;
				return { error: { code, message } };
			}

			try {
				const document = rq.text ? (await response.text()).trim() : await response.json();
				const cache = {
					etag: response.headers.get('ETag') || undefined,
					lastModified: response.headers.get('Last-Modified') || undefined
				};

				return { document, found: true, cache };
			} catch (exc) {
				const code = 'PROVIDER_RESPONSE_NOT_PARSABLE';
				const message = 'The provider response could not be parsed';
				return { error: { code, message } };
			}
		} finally {
			clearTimeout(timer);
		}
	}
}
