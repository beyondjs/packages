import { request } from 'node:http';
import { ContractError } from '@beyond-js/artifact-api';
import { Deadline } from './deadline.mjs';
import { Description } from './description.mjs';
import { AbortError, AccessError, TimeoutError, Transport } from './errors.mjs';

export { AbortError, AccessError, TimeoutError };

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
	 * The default deadline of an installation, in milliseconds, response body included. Bounds nest: it is longer
	 * than the worst case of the service for one request, which is the wait for the installations before it
	 * (`BEYOND_INSTALL_QUEUE_TIMEOUT`, 120 s), the installation itself (`BEYOND_INSTALL_DEADLINE`, 540 s) and the
	 * reload of the workspace after it (`BEYOND_WORKSPACE_TIMEOUT`, 120 s), so the service's own answer, a refusal
	 * whose outcome is known included, arrives before this one ends the wait. A deployment that raises those
	 * raises this one too.
	 */
	static INSTALL = 900000;

	/**
	 * How many heartbeats of silence mean that an attached service stopped answering
	 */
	static SILENCE = 2.5;

	static #deadlines = {
		session: new Deadline('BEYOND_SESSION_TIMEOUT', Connection.TIMEOUT),
		request: new Deadline('BEYOND_REQUEST_TIMEOUT', Connection.REQUEST),
		install: new Deadline('BEYOND_INSTALL_TIMEOUT', Connection.INSTALL)
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
	 * @returns {Promise<Connection | undefined>} undefined when no compatible service answers there: nothing
	 * accepts the connection, or what answers is not that service
	 * @throws {AccessError} When something answers there and refuses this client. That is not a stale
	 * record: a guarded service that is alive must not be discarded, or replaced, by a client without access.
	 * @throws {TimeoutError} When a service is there and does not answer within the deadline, which is not
	 * a stale record either.
	 * @throws {ContractError} `UNAVAILABLE` when a service is there and answers that it cannot describe itself
	 * now (a 5xx or 429): an unavailable service is not a stale record, and is never replaced by a second one.
	 */
	static async validate(record, expected, headers = {}) {
		const session = await Description.read(record, expected, { headers, deadline: Connection.deadline(process.env) });
		return session && new Connection(record.origin, session, headers);
	}

	/**
	 * A JSON document, or undefined for a body that is not one
	 */
	static #parsed(text) {
		try {
			return text ? JSON.parse(text) : void 0;
		} catch {
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

	/**
	 * How long an installation is waited for, body included (`BEYOND_INSTALL_TIMEOUT`)
	 *
	 * @param {Record<string, string | undefined>} environment
	 */
	static allowance(environment) {
		return Connection.#deadlines.install.read(environment);
	}

	/**
	 * A JSON answer of the service. The signal bounds the response body as well as its headers: a service that
	 * sends its status and then stalls is as stuck as one that never answers. A request that sends a body changes
	 * something, so one that got no answer, because its bound expired or its connection ended on its way, reports
	 * an unknown outcome with how to find it out; only a connection that nothing accepted is known not to have
	 * reached the service. An error answer that is not a document of the service is the error of its status.
	 *
	 * The caller may stop waiting with its own signal, combined with the bound: the connection is then closed and
	 * the stop is reported as the caller's (`AbortError`), never as a service that did not answer.
	 *
	 * @param {string} path
	 * @param {{body?: object, bound?: Deadline, check?: string, signal?: AbortSignal}} [request] The JSON body of a
	 * `POST`, the bound of the wait (`BEYOND_REQUEST_TIMEOUT` by default), how to learn the outcome of a change, and
	 * the caller's signal
	 */
	async #json(path, { body, bound = Connection.#deadlines.request, check, signal } = {}) {
		const deadline = bound.read(process.env);
		const method = body === undefined ? 'GET' : 'POST';
		const headers = body === undefined ? this.#headers : { ...this.#headers, 'content-type': 'application/json' };
		const payload = body === undefined ? void 0 : JSON.stringify(body);
		const request = { path: path.split('?')[0], method, variable: bound.name, check };
		if (signal?.aborted) throw new AbortError(this.#origin, { ...request, sent: false, reason: signal.reason });

		const expiry = AbortSignal.timeout(deadline);
		let response, text;
		try {
			response = await fetch(`${this.#origin}${path}`, { method, headers, body: payload, signal: signal ? AbortSignal.any([signal, expiry]) : expiry });
			text = await response.text();
		} catch (error) {
			if (signal?.aborted) throw new AbortError(this.#origin, { ...request, reason: signal.reason });
			if (Transport.expired(error)) throw new TimeoutError(this.#origin, deadline, request);
			if (body === undefined || Transport.refused(error)) throw error;
			throw Object.assign(new TimeoutError(this.#origin, deadline, { ...request, dropped: Transport.reason(error) }), { cause: error });
		}

		const answer = Connection.#parsed(text);
		if (!response.ok) throw ContractError.from(response.status, answer) ?? ContractError.of({ status: response.status });
		if (answer === undefined) throw new ContractError('INTERNAL', `${method} ${path.split('?')[0]} was answered with a document that is not JSON`);
		return answer;
	}

	/**
	 * The installation state of the workspace: the projection of its installed graph (`ready`, `missing`,
	 * `stale`, `incomplete` or `incompatible`, with diagnostics), its declaration, its lock and its projection.
	 * It reads files and builds nothing, within `BEYOND_REQUEST_TIMEOUT`.
	 *
	 * @returns {Promise<object>}
	 */
	installation() {
		return this.#json('/installation');
	}

	/**
	 * Installs the workspace: resolves its graph, fetches what the store lacks, writes the lock and the
	 * projection, and has the service serve the installed graph. Installations of one service run one at a
	 * time. An installation that is not valid is still an answer: the report says what failed.
	 *
	 * @param {{update?: boolean, offline?: boolean, signal?: AbortSignal}} [options] Resolve again ignoring the
	 * lock; refuse every request to a registry; and the caller's signal to stop waiting, which closes the
	 * connection and leaves the installation to the service
	 * @returns {Promise<object>} The installation report (`beyond-installation/1`), valid or not
	 * @throws {ContractError} `DECLARATION_INVALID` (422) when the workspace declaration has errors, with its
	 * diagnostics; `OPTION_INVALID` (400) for options that are not booleans
	 * @throws {TimeoutError} `SERVICE_NOT_ANSWERING` with `outcome: 'unknown'` when no answer arrived, within
	 * `BEYOND_INSTALL_TIMEOUT` or because the connection ended on its way: whether the installation was carried
	 * out is then unknown
	 * @throws {ContractError} `UNAVAILABLE` (503) when installations ahead of this one did not end within the
	 * service's `BEYOND_INSTALL_QUEUE_TIMEOUT`: this one was not started
	 * @throws {AbortError} `REQUEST_ABORTED` when the caller's signal stopped the wait: `outcome: 'unknown'` once
	 * the request was sent, `'none'` when it was stopped before
	 */
	install({ update, offline, signal } = {}) {
		const body = { ...(update === undefined ? {} : { update }), ...(offline === undefined ? {} : { offline }) };
		const check = 'ask the service for the installation state (GET /installation) before installing again';
		return this.#json('/installation', { body, bound: Connection.#deadlines.install, check, signal });
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
