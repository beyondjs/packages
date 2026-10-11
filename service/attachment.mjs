import { request } from 'node:http';
import { TimeoutError } from './errors.mjs';

/**
 * One attachment of a client to a running service: an event stream held open (`GET /attach?kind=`), which is the
 * whole protocol of who uses the service (see the host's `Attachments`).
 *
 * The first answer is waited for within a deadline; the service writes it as soon as the stream opens. A service that
 * announces a heartbeat and then stays silent for `Attachment.SILENCE` heartbeats has stopped answering, although its
 * connection looks open: the stream is closed and `stopping` is called, as when the service ends. A service that
 * announces none is not held to one. The start token of an owner travels in the `Beyond-Owner` header, never in the
 * address, which proxies and logs keep. Every other event the service writes (such as `paired`, a new pairing of a
 * browser page) is given to `observe`.
 *
 * ```js
 * const { detach } = await new Attachment(origin, headers, deadline).open('owner', { token, stopping, observe });
 * ```
 */
export class Attachment {
	/**
	 * How many heartbeats of silence mean that an attached service stopped answering
	 */
	static SILENCE = 2.5;

	#origin;
	#headers;
	#deadline;

	/**
	 * @param {string} origin The origin of the service
	 * @param {Record<string, string>} headers The access context the client presents
	 * @param {number} deadline Milliseconds the first answer is waited for
	 */
	constructor(origin, headers, deadline) {
		this.#origin = origin;
		this.#headers = headers;
		this.#deadline = deadline;
	}

	/**
	 * The events of a chunk of the stream: `{type, data}`, data parsed when it is JSON
	 */
	static #events(text) {
		return [...text.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)].map(([, type, data]) => {
			try {
				return { type, data: JSON.parse(data) };
			} catch {
				return { type, data };
			}
		});
	}

	/**
	 * @param {'owner' | 'session' | 'consumer'} kind
	 * @param {{token?: string, stopping?: (reason: string) => void, observe?: (event: {type: string, data: unknown})
	 * => void}} [options] The start token of an owner, what to do when the service says it is stopping or disappears,
	 * and what to do with its other events
	 * @returns {Promise<{detach: () => void}>}
	 * @throws {TimeoutError} When the service does not answer the attachment in time
	 */
	open(kind, { token, stopping, observe } = {}) {
		const headers = token ? { ...this.#headers, 'beyond-owner': token } : this.#headers;
		const deadline = this.#deadline;

		return new Promise((resolve, reject) => {
			let attached = false;
			let detached = false;
			let reason = 'the service ended';
			let pending = '';

			const stream = request(`${this.#origin}/attach?${new URLSearchParams({ kind })}`, { headers }, response => {
				if (response.statusCode !== 200) {
					response.resume();
					return reject(new Error(`The service refused the "${kind}" attachment (HTTP ${response.statusCode})`));
				}

				response.setEncoding('utf8');
				response.on('error', () => void 0);
				response.on('data', chunk => {
					pending += chunk;
					const complete = pending.lastIndexOf('\n\n');
					if (complete === -1) return;
					const events = Attachment.#events(pending.slice(0, complete + 2));
					pending = pending.slice(complete + 2);
					for (const event of events) {
						if (event.type === 'attached') {
							attached = true;
							const heartbeat = Number.isInteger(event.data?.heartbeat) && event.data.heartbeat > 0 ? event.data.heartbeat : 0;
							stream.setTimeout(heartbeat * Attachment.SILENCE);
							resolve({
								detach: () => {
									detached = true;
									stream.destroy();
								}
							});
						} else if (event.type === 'stopping') reason = event.data?.reason ?? reason;
						else observe?.(event);
					}
				});
				response.on('close', () => attached && !detached && stopping?.(reason));
			});

			// Silence is bounded by the deadline of a first answer until the service answers, and by its heartbeat
			// afterwards
			stream.setTimeout(deadline);
			stream.on('timeout', () => {
				if (!attached) reject(new TimeoutError(this.#origin, deadline, { path: '/attach' }));
				else reason = 'the service stopped answering';
				stream.destroy();
			});
			stream.on('error', error => reject(error));
			stream.end();
		});
	}
}
