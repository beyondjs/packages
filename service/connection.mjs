import { request } from 'node:http';
import { ContractError, Session } from '@beyond-js/artifact-api';

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
	constructor(origin, deadline) {
		super(`The development service at ${origin} did not describe itself within ${deadline}ms. Raise BEYOND_SESSION_TIMEOUT if the host is slow`);
		this.name = 'TimeoutError';
		this.code = 'SERVICE_NOT_ANSWERING';
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
		const given = environment.BEYOND_SESSION_TIMEOUT;
		if (given === void 0 || given === '') return Connection.TIMEOUT;
		if (!/^[1-9]\d*$/.test(given)) throw new Error('BEYOND_SESSION_TIMEOUT must be a whole number of milliseconds');
		return Number(given);
	}

	static #expired(error) {
		return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
	}

	static #refusal(status, record) {
		if (!status) return;
		throw new AccessError(`The development service at ${record.origin} refused access (HTTP ${status})`);
	}

	async #json(path) {
		const response = await fetch(`${this.#origin}${path}`, { headers: this.#headers });
		const body = await response.json();
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
	 * Attaches to the service and stays attached until `detach()` or until this process ends
	 *
	 * @param {'owner' | 'session' | 'consumer'} kind
	 * @param {{token?: string, stopping?: (reason: string) => void}} [options] The start token of an owner,
	 * and what to do when the service says it is stopping or disappears
	 * @returns {Promise<{detach: () => void}>}
	 */
	attach(kind, { token, stopping } = {}) {
		const query = new URLSearchParams(token ? { kind, token } : { kind });

		return new Promise((resolve, reject) => {
			const stream = request(`${this.#origin}/attach?${query}`, { headers: this.#headers }, response => {
				if (response.statusCode !== 200) {
					response.resume();
					return reject(new Error(`The service refused the "${kind}" attachment (HTTP ${response.statusCode})`));
				}

				let detached = false;
				let reason = 'the service ended';
				response.setEncoding('utf8');
				response.on('data', chunk => {
					const match = /event: stopping\ndata: (.*)\n/.exec(chunk);
					if (match) reason = JSON.parse(match[1]).reason;
				});
				response.on('close', () => !detached && stopping?.(reason));
				response.once('data', () =>
					resolve({
						detach: () => {
							detached = true;
							stream.destroy();
						}
					})
				);
			});
			stream.on('error', error => reject(error));
			stream.end();
		});
	}
}
