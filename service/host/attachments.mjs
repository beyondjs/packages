import { randomUUID } from 'node:crypto';
import { Caller } from './pairing/caller.mjs';

/**
 * Who is using the service right now.
 *
 * An attachment is an open event stream (`GET /attach`). Holding it open is the whole protocol: a client
 * that ends, crashes or loses its terminal closes the connection, and the service notices without any
 * cooperation from it. Through the same stream the service tells its clients that it is stopping.
 *
 * - `owner`: the foreground session that started the service. Only the holder of the start token is one.
 * - `session`: a foreground session that found the service already running.
 * - `consumer`: an application being executed against the service.
 *
 * Every stream carries a comment line (`: heartbeat`) every `heartbeat` milliseconds, announced in the
 * `attached` event. It proves liveness in both directions: a client whose connection still looks open can
 * tell that the service stopped answering, and a write to a client whose connection is gone closes its
 * attachment. Event-stream parsers ignore comment lines.
 *
 * On a service that pairs browsers, a stream that a paired page opened ends with an `access.ended` event, whose
 * `reason` is `PAIRING_EXPIRED` or `PAIRING_REVOKED`, when its pairing ends, and every stream is told of each new
 * pairing (`paired`, with its identifier and origin), so the command line names it.
 *
 * The owner proves it started the service with the start token in the `Beyond-Owner` header, never in the address
 * of the stream, which proxies and logs keep.
 */
export class Attachments {
	/** The default interval of the heartbeat, in milliseconds, as the `/events` stream of the development extension */
	static HEARTBEAT = 20000;

	#token;
	#heartbeat;
	#timer;
	#streams = new Map();
	#listeners = new Set();

	/**
	 * @param {string} [token] What proves that a client is the one that started the service
	 * @param {{heartbeat?: number}} [options] The interval of the heartbeat, in milliseconds
	 */
	constructor(token, { heartbeat = Attachments.HEARTBEAT } = {}) {
		this.#token = token;
		this.#heartbeat = heartbeat;
	}

	get size() {
		return this.#streams.size;
	}

	get owned() {
		return [...this.#streams.values()].some(({ kind }) => kind === 'owner');
	}

	/**
	 * What is attached, for whoever inspects the state of the service
	 */
	get list() {
		return [...this.#streams.entries()].map(([id, { kind, since }]) => ({ id, kind, since }));
	}

	/**
	 * Calls back whenever a client attaches or detaches
	 *
	 * @param {(event: {type: 'attached' | 'detached', kind: string}) => void} listener
	 */
	observe(listener) {
		this.#listeners.add(listener);
	}

	/**
	 * Mounts the attachment stream
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.get('/attach', (request, response) => {
			const kind = String(request.query.kind ?? '');
			if (!['owner', 'session', 'consumer'].includes(kind)) {
				return response.status(400).json({ error: { code: 'ATTACHMENT_INVALID', message: `Unknown attachment kind "${kind}"` } });
			}
			if (kind === 'owner' && (!this.#token || request.headers['beyond-owner'] !== this.#token || this.owned)) {
				const message = 'Only the session that started this service can own it';
				return response.status(403).json({ error: { code: 'ATTACHMENT_FORBIDDEN', message } });
			}

			const id = randomUUID();
			response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
			response.write(`event: attached\ndata: ${JSON.stringify({ id, kind, heartbeat: this.#heartbeat })}\n\n`);

			this.#streams.set(id, { kind, response, since: new Date().toISOString() });
			this.#listeners.forEach(listener => listener({ type: 'attached', kind }));
			this.#beat();

			const release = Caller.of(request)?.ended(reason => {
				response.write(`event: access.ended\ndata: ${JSON.stringify({ reason })}\n\n`);
				response.end();
			});
			request.on('close', () => {
				release?.();
				if (!this.#streams.delete(id)) return;
				this.#listeners.forEach(listener => listener({ type: 'detached', kind }));
			});
		});
	}

	/**
	 * Tells every client an event of the service, such as a new pairing
	 *
	 * @param {string} type
	 * @param {object} data
	 */
	announce(type, data) {
		this.#streams.forEach(({ response }) => response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
	}

	/**
	 * Starts the heartbeat of the open streams, once. It does not keep the process alive by itself.
	 */
	#beat() {
		if (this.#timer) return;
		this.#timer = setInterval(() => this.#streams.forEach(({ response }) => response.write(': heartbeat\n\n')), this.#heartbeat);
		this.#timer.unref();
	}

	/**
	 * Tells every client why the service ends, and ends their streams
	 */
	close(reason) {
		clearInterval(this.#timer);
		this.#timer = void 0;
		this.#streams.forEach(({ response }) => {
			response.write(`event: stopping\ndata: ${JSON.stringify({ reason })}\n\n`);
			response.end();
		});
		this.#streams.clear();
	}
}
