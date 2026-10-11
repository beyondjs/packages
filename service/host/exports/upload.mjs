import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as plain } from 'node:http';
import { request as secure } from 'node:https';
import { Loopback } from './loopback.mjs';

/**
 * One archive sent to Snapshots with its upload grant: `PUT <upload>` with `Authorization: Grant <token>`,
 * `Content-Type: application/x-tar` and the exact `Content-Length`.
 *
 * The archive is read and hashed again first, and bytes that are not the exported ones are `EXPORT_CHANGED` with
 * nothing sent. A redirect is never followed (`EXPORT_DESTINATION`). A name under `localhost` is connected to
 * `127.0.0.1`, with the address and its `Host` as given (`Loopback`). The upload is bounded
 * (`BEYOND_EXPORT_UPLOAD_TIMEOUT`, 120 s by default). Its outcome is what can be known of it:
 *
 * | Outcome | When |
 * | --- | --- |
 * | `stored` | A `2xx` answer |
 * | `failed` | A refusal (`4xx`, its code when it names one, `UPLOAD_REFUSED` otherwise), a redirect, changed bytes, or a destination that accepted no connection (`UPLOAD_UNREACHABLE`): nothing was stored |
 * | `unknown` | No answer within the bound (`UPLOAD_TIMEOUT`), a connection that ended on its way (`UPLOAD_DROPPED`), a `5xx` answer, or a cancellation (`UPLOAD_CANCELLED`): Snapshots may hold the package, which is read there before sending it again |
 *
 * The token is used for this request only: it is never written to a record or a log.
 */
export class Upload {
	static TIMEOUT = 120000;

	/**
	 * Errors of a connection that never reached the destination, so nothing was sent
	 */
	static #UNREACHED = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_INVALID_URL'];

	#archive;
	#grant;
	#timeout;
	#signal;

	/**
	 * @param {{file: string, digest: string, bytes: number}} archive The archive and what was exported
	 * @param {{upload: string, token: string}} grant
	 * @param {{timeout?: number, signal?: AbortSignal}} [options] The bound in milliseconds, and the signal of a
	 * cancellation
	 */
	constructor(archive, grant, { timeout = Upload.TIMEOUT, signal } = {}) {
		this.#archive = archive;
		this.#grant = grant;
		this.#timeout = timeout;
		this.#signal = signal;
	}

	static #outcome(state, code, message) {
		return { state, error: { code, message } };
	}

	/**
	 * @returns {Promise<{state: 'stored' | 'failed' | 'unknown', error?: {code: string, message: string}}>}
	 */
	async send() {
		let bytes;
		try {
			bytes = await readFile(this.#archive.file);
		} catch {
			return Upload.#outcome('failed', 'EXPORT_CHANGED', 'The archive of this package is no longer on disk: export the package again');
		}
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (digest !== this.#archive.digest || bytes.length !== this.#archive.bytes) {
			return Upload.#outcome('failed', 'EXPORT_CHANGED', 'The archive of this package changed since it was exported, and nothing was sent: export the package again');
		}
		if (this.#signal?.aborted) return Upload.#outcome('failed', 'UPLOAD_CANCELLED', 'The transfer was cancelled before this package was sent');
		return this.#request(bytes);
	}

	#request(bytes) {
		const url = new URL(this.#grant.upload);
		const request = url.protocol === 'https:' ? secure : plain;
		return new Promise(resolve => {
			let settled = false;
			const settle = outcome => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.#signal?.removeEventListener('abort', cancel);
				resolve(outcome);
			};

			const headers = { authorization: `Grant ${this.#grant.token}`, 'content-type': 'application/x-tar', 'content-length': String(bytes.length) };
			const sent = request(url, { method: 'PUT', headers, lookup: Loopback.lookup }, response => this.#answer(response).then(settle));
			const timer = setTimeout(() => {
				settle(Upload.#outcome('unknown', 'UPLOAD_TIMEOUT', `Snapshots did not answer within ${this.#timeout} ms: whether it stored the package is unknown`));
				sent.destroy();
			}, this.#timeout);
			const cancel = () => {
				settle(Upload.#outcome('unknown', 'UPLOAD_CANCELLED', 'The transfer was cancelled while this package was being sent'));
				sent.destroy();
			};
			this.#signal?.addEventListener('abort', cancel, { once: true });

			sent.on('error', error => {
				const unreached = Upload.#UNREACHED.includes(error.code);
				settle(unreached
					? Upload.#outcome('failed', 'UPLOAD_UNREACHABLE', `Snapshots accepted no connection (${error.code}): nothing was sent`)
					: Upload.#outcome('unknown', 'UPLOAD_DROPPED', `The connection ended before Snapshots answered (${error.code ?? error.message}): whether it stored the package is unknown`));
			});
			sent.end(bytes);
		});
	}

	/**
	 * What an answer says of the upload, its body read within a small bound
	 */
	async #answer(response) {
		const { statusCode: status } = response;
		let text = '';
		try {
			for await (const chunk of response) if ((text += chunk).length > 65536) break;
		} catch {
			// The status is the answer; a body that ends early does not change it
		}
		if (status >= 200 && status < 300) return { state: 'stored' };
		if (status >= 300 && status < 400) return Upload.#outcome('failed', 'EXPORT_DESTINATION', `Snapshots answered with a redirect (${status}), which is not followed: nothing more was sent`);

		let error;
		try {
			error = JSON.parse(text)?.error;
		} catch {
			// Not a document of the service
		}
		const code = typeof error?.code === 'string' ? error.code : status >= 500 ? 'UPLOAD_UNAVAILABLE' : 'UPLOAD_REFUSED';
		const message = typeof error?.message === 'string' ? error.message : `Snapshots answered ${status}`;
		return Upload.#outcome(status >= 500 ? 'unknown' : 'failed', code, message);
	}
}
