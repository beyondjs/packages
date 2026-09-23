import type { ICacheOptions, IPackageResponseBase } from '@beyond-js/packages/providers/types';

/**
 * How a request reaches the network: the global `fetch`, or one the consumer injects (a transport that
 * validates destinations, for example). It must behave as `fetch` does, `redirect` and `signal` included.
 */
export /*bundle*/ type Transport = (url: string, init?: RequestInit) => Promise<Response>;

export /*bundle*/ interface IFetchRq {
	url: string;
	headers?: Record<string, string>;
	cache?: ICacheOptions;
	// Milliseconds before the request is abandoned
	timeout?: number;
	// Read the body as text instead of JSON (`document` is then a string)
	text?: boolean;
	// Bytes of body read at most; a longer body is `PROVIDER_RESPONSE_TOO_LARGE`. Unbounded when absent
	limit?: number;
	// The transport of the request; the global `fetch` when absent
	transport?: Transport;
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
	 * Reads a body up to a limit, cancelling the transfer at the first byte over it
	 */
	static async #body(response: Response, limit?: number): Promise<string | undefined> {
		if (!limit || !response.body) return response.text();

		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.length;
			if (length > limit) {
				await reader.cancel().catch((): void => {});
				return undefined;
			}
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString('utf8');
	}

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
		const transport = rq.transport || fetch;

		try {
			let response: Response;
			try {
				response = await transport(url, { headers, signal: abort.signal });
			} catch (exc) {
				// A transport that refuses a destination says so with a code of its own
				const refused = typeof exc?.code === 'string' && exc.code === 'DESTINATION_REFUSED';
				const code = refused ? exc.code : 'NETWORK_ERROR';
				const message = refused ? String(exc.message) : `The provider could not be reached: ${new URL(url).host}`;
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
				const body = await PackageRegistryFetcher.#body(response, rq.limit);
				if (body === undefined) {
					const message = `The response of ${new URL(url).host} exceeds ${rq.limit} bytes`;
					return { error: { code: 'PROVIDER_RESPONSE_TOO_LARGE', message } };
				}

				const document = rq.text ? body.trim() : JSON.parse(body);
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
