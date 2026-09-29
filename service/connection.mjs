import { request } from 'node:http';
import { ContractError, Session } from '@beyond-js/artifact-api';
import { Deadline } from './deadline.mjs';

/**
 * A service that is running and does not admit this client
 */
export class AccessError extends Error {
	constructor(message) {
		super(message);
		this.name = 'AccessError';
		this.code = 'SERVICE_ACCESS_REFUSED';
	}
}

/**
 * A service that is there but did not answer within the deadline. A slow answer is not a wrong one: the
 * record of a service that is alive must not be discarded, and a second service must not be started.
 */
export class TimeoutError extends Error {
	/**
	 * @param {string} origin
	 * @param {number} deadline Milliseconds
	 * @param {{path?: string, variable?: string}} [request] The request that was not answered, and the
	 * variable that bounds it; without them, the first description of the service
	 */
	constructor(origin, deadline, { path, variable = 'BEYOND_SESSION_TIMEOUT' } = {}) {
		const what = path ? `answer GET ${path}` : 'describe itself';
		super(`The development service at ${origin} did not ${what} within ${deadline}ms. Raise ${variable} if the host is slow`);
		this.name = 'TimeoutError';
		this.code = 'SERVICE_NOT_ANSWERING';
		this.path = path;
	}
}

/**
 * A validated connection to a running development service.
 *
 * Reaching an address is not enough to use a service: the record that named it may be stale, and the port
 * may now belong to something else. A connection exists only after the live service described itself and
 * that description matched the workspace and the toolchain of the caller.
 */
export class Connection {
	// The default deadline of the first description, in milliseconds
	static TIMEOUT = 5000;

	/**
	 * The default deadline of a selection or a state, in milliseconds, response body included. Answering
	 * them builds what changed, which on a first build of a large workspace on a loaded host takes minutes;
	 * it is longer than the host's own bound on reading the workspace, so a reload that does not settle is
	 * reported by the service (`UNAVAILABLE`) before this deadline ends the wait.
	 */
	static REQUEST = 300000;

	/**
	 * How many heartbeats of silence mean that an attached service stopped answering
	 */
	static SILENCE = 2.5;

	static #deadlines = {
		session: new Deadline('BEYOND_SESSION_TIMEOUT', Connection.TIMEOUT),
		request: new Deadline('BEYOND_REQUEST_TIMEOUT', Connection.REQUEST)
	};

	#origin;
	#session;
	#headers;

	get origin() {
		return this.#origin;
	}

	/**
	 * The session description the service gave when the connection was validated
	 */
	get session() {
		return this.#session;
	}

	constructor(origin, session, headers = {}) {
		this.#origin = origin;
		this.#session = session;
		this.#headers = headers;
	}

	/**
	 * @param {{origin: string, pid?: number}} record Where a service is said to be
	 * @param {{root: string, toolchain: string}} expected What the service must be serving
	 * @param {Record<string, string>} [headers] The access context of a service whose host guards its routes
	 * @returns {Promise<Connection | undefined>} undefined when no compatible service answers there
	 * @throws {AccessError} When something answers there and refuses this client. That is not a stale
	 * record: a guarded service that is alive must not be discarded, or replaced, by a client without access.
	 * @throws {TimeoutError} When a service is there and does not answer within the deadline, which is not
	 * a stale record either.
	 */
	static async validate(record, expected, headers = {}) {
		const deadline = Connection.deadline(process.env);
		let refused;
		try {
			const response = await fetch(`${record.origin}${Session.PATH}`, { headers, signal: AbortSignal.timeout(deadline) });
			if ([401, 403].includes(response.status)) refused = response.status;
			if (!response.ok) return Connection.#refusal(refused, record);

			const session = new Session(await response.json());
			const same = session.workspace.root === expected.root && session.service.toolchain === expected.toolchain;
			if (!same || (record.pid && session.service.pid !== record.pid)) return;
			return new Connection(record.origin, session, headers);
		} catch (error) {
			if (error instanceof AccessError) throw error;

			// Nothing answering is a stale record; answering too late is a live service, and saying so is
			// what keeps a loaded host from losing the service it already has
			if (Connection.#expired(error)) throw new TimeoutError(record.origin, deadline);
			return;
		}
	}

	/**
	 * How long the first description of a service is waited for. It is deployment configuration, like the
	 * deadline of the watchers child: inside a saturated container the answer crosses the default although
	 * the service is healthy.
	 *
	 * @param {Record<string, string | undefined>} environment
	 */
	static deadline(environment) {
		return Connection.#deadlines.session.read(environment);
	}

	/**
	 * How long a selection or a state is waited for, body included (`BEYOND_REQUEST_TIMEOUT`)
	 *
	 * @param {Record<string, string | undefined>} environment
	 */
	static limit(environment) {
		return Connection.#deadlines.request.read(environment);
	}

	static #expired(error) {
		return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
	}

	static #refusal(status, record) {
		if (!status) return;
		throw new AccessError(`The development service at ${record.origin} refused access (HTTP ${status})`);
	}

	/**
	 * A description the service computes. The signal bounds the response body as well as its headers: a
	 * service that sends its status and then stalls is as stuck as one that never answers.
	 */
	async #json(path) {
		const deadline = Connection.limit(process.env);
		let response, body;
		try {
			response = await fetch(`${this.#origin}${path}`, { headers: this.#headers, signal: AbortSignal.timeout(deadline) });
			body = await response.json();
		} catch (error) {
			if (!Connection.#expired(error)) throw error;
			const variable = Connection.#deadlines.request.name;
			throw new TimeoutError(this.#origin, deadline, { path: path.split('?')[0], variable });
		}
		if (!response.ok) throw ContractError.from(response.status, body) ?? new Error(`${path}: HTTP ${response.status}`);
		return body;
	}

	/**
	 * Resolves a selector and checks that the modules it reaches build
	 *
	 * @param {string} selector
	 * @param {string} directory Where a local selector is resolved from
	 */
	selection(selector, directory) {
		return this.#json(`/selection?${new URLSearchParams({ selector, directory })}`);
	}

	/**
	 * The build state of every public module of the workspace
	 */
	state() {
		return this.#json('/state');
	}

	/**
	 * Attaches to the service and stays attached until `detach()` or until this process ends.
	 *
	 * The first answer is waited for as long as a first description (`BEYOND_SESSION_TIMEOUT`); the service
	 * writes it as soon as the stream opens. A service that announces a heartbeat and then stays silent for
	 * `Connection.SILENCE` heartbeats has stopped answering, although its connection looks open: the stream
	 * is closed and `stopping` is called, as when the service ends. A service that announces none is not
	 * held to one.
	 *
	 * @param {'owner' | 'session' | 'consumer'} kind
	 * @param {{token?: string, stopping?: (reason: string) => void}} [options] The start token of an owner,
	 * and what to do when the service says it is stopping or disappears
	 * @returns {Promise<{detach: () => void}>}
	 * @throws {TimeoutError} When the service does not answer the attachment in time
	 */
	attach(kind, { token, stopping } = {}) {
		const query = new URLSearchParams(token ? { kind, token } : { kind });
		const deadline = Connection.deadline(process.env);

		return new Promise((resolve, reject) => {
			let attached = false;
			let detached = false;
			let reason = 'the service ended';

			const stream = request(`${this.#origin}/attach?${query}`, { headers: this.#headers }, response => {
				if (response.statusCode !== 200) {
					response.resume();
					return reject(new Error(`The service refused the "${kind}" attachment (HTTP ${response.statusCode})`));
				}

				response.setEncoding('utf8');
				response.on('error', () => void 0);
				response.on('data', chunk => {
					const match = /event: stopping\ndata: (.*)\n/.exec(chunk);
					if (match) reason = JSON.parse(match[1]).reason;
				});
				response.on('close', () => attached && !detached && stopping?.(reason));
				response.once('data', chunk => {
					attached = true;
					const heartbeat = Connection.#heartbeat(chunk);
					stream.setTimeout(heartbeat ? heartbeat * Connection.SILENCE : 0);
					resolve({
						detach: () => {
							detached = true;
							stream.destroy();
						}
					});
				});
			});

			// Silence is bounded by the deadline of a first answer until the service answers, and by its
			// heartbeat afterwards
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

	/**
	 * The heartbeat, in milliseconds, that the `attached` event of the service announces
	 */
	static #heartbeat(chunk) {
		const match = /event: attached\ndata: (.*)\n/.exec(chunk);
		try {
			const { heartbeat } = JSON.parse(match?.[1] ?? '{}');
			return Number.isInteger(heartbeat) && heartbeat > 0 ? heartbeat : void 0;
		} catch {
			return;
		}
	}
}
