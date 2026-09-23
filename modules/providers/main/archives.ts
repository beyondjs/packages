import type { IPackageArchiveResponse } from '@beyond-js/packages/providers/types';
import type { Transport } from './fetcher';
import { createHash } from 'crypto';

/**
 * Pins an archive URL that declares no integrity: it is downloaded once, while its bytes are counted and
 * hashed, and its `sha512` becomes the identity of the release. Nothing is extracted or kept.
 */
export class Archives {
	#transport?: Transport;
	#limit: number;
	#timeout: number;

	/**
	 * @param limit Compressed bytes read at most (64 MiB, the default archive limit of a fetch)
	 */
	constructor(transport?: Transport, limit = 64 * 1024 * 1024, timeout = 120_000) {
		this.#transport = transport;
		this.#limit = limit;
		this.#timeout = timeout;
	}

	async digest(url: string, headers: Record<string, string>): Promise<IPackageArchiveResponse> {
		const host = new URL(url).host;
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), this.#timeout);
		const failure = (code: string, message: string) => ({ error: { code, message } });

		try {
			let response: Response;
			try {
				response = await (this.#transport || fetch)(url, { headers, signal: abort.signal });
			} catch (exc) {
				if (exc?.code === 'DESTINATION_REFUSED') return failure(exc.code, String(exc.message));
				return failure('NETWORK_ERROR', `The archive could not be requested to ${host}`);
			}

			const { status } = response;
			if (status === 401 || status === 403) {
				const code = status === 401 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_AUTH_DENIED';
				return failure(code, `${host} refused the archive with status ${status}`);
			}
			if (status === 404) return failure('ARCHIVE_NOT_FOUND', `${host} does not have the archive`);
			if (!response.ok || !response.body) return failure('DOWNLOAD_FAILED', `${host} answered the archive with status ${status}`);

			const declared = Number(response.headers.get('content-length'));
			const oversize = () => failure('ARCHIVE_TOO_LARGE', `The archive exceeds the limit of ${this.#limit} bytes`);
			if (declared > this.#limit) {
				await response.body.cancel().catch((): void => {});
				return oversize();
			}

			const hash = createHash('sha512');
			const reader = response.body.getReader();
			let bytes = 0;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					bytes += value.length;
					if (bytes > this.#limit) {
						await reader.cancel().catch((): void => {});
						return oversize();
					}
					hash.update(value);
				}
			} catch {
				return failure('DOWNLOAD_FAILED', 'The transfer of the archive was interrupted');
			}
			if (!bytes) return failure('DOWNLOAD_FAILED', `${host} answered an empty archive`);

			return { integrity: `sha512-${hash.digest('base64')}`, bytes };
		} finally {
			abort.abort();
			clearTimeout(timer);
		}
	}
}
