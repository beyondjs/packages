import { ContractError } from '@beyond-js/artifact-api';
import { Connection } from './connection.mjs';
import { TimeoutError, Transport } from './errors.mjs';

/**
 * The pairings of a running service, as a process of the machine where it runs manages them
 * (`beyond-dev-pairing/1`): a new code for a browser page, the pairings that are valid, and their revocation. Only a
 * local process may do it, which a client of this module is: it sends no `Origin`.
 *
 * Each request is bounded by `BEYOND_SESSION_TIMEOUT` (5 s by default): the service answers them at once. A code
 * whose request got no answer may have been created; it is never shown, and asking again creates another one.
 *
 * ```js
 * const pairing = new PairingClient(connection.origin);
 * const { code, expires } = await pairing.code({ origins: ['https://packages.example'] });
 * await pairing.list();          // [{id, origin, created, used, expires}]
 * await pairing.revoke(id);      // or every pairing, without an identifier
 * ```
 */
export class PairingClient {
	#origin;
	#headers;

	/**
	 * @param {string} origin The origin of the service
	 * @param {Record<string, string>} [headers] The access context of a service whose host guards its routes
	 */
	constructor(origin, headers = {}) {
		this.#origin = origin;
		this.#headers = headers;
	}

	async #request(method, path, body) {
		const deadline = Connection.deadline(process.env);
		const headers = body === undefined ? this.#headers : { ...this.#headers, 'content-type': 'application/json' };
		let response, text;
		try {
			response = await fetch(`${this.#origin}${path}`, { method, headers, body: body === undefined ? void 0 : JSON.stringify(body), signal: AbortSignal.timeout(deadline) });
			text = await response.text();
		} catch (error) {
			if (Transport.expired(error)) throw new TimeoutError(this.#origin, deadline, { path, method });
			throw error;
		}

		let answer;
		try {
			answer = text ? JSON.parse(text) : void 0;
		} catch {
			// An answer that is not a document of the service: its status says enough
		}
		if (!response.ok) throw ContractError.from(response.status, answer) ?? ContractError.of({ status: response.status });
		return answer;
	}

	/**
	 * A new pairing code, valid once for ten minutes
	 *
	 * @param {{origins?: string[]}} [options] Interface origins that may redeem it besides the service's allowed ones
	 * @returns {Promise<{code: string, expires: string, origins: string[]}>}
	 * @throws {ContractError} `PAIRING_LOCAL` from a service that does not take this process for a local one, or
	 * `NOT_FOUND` from a service that does not pair browsers
	 */
	code({ origins = [] } = {}) {
		return this.#request('POST', '/pairing/codes', { origins });
	}

	/**
	 * The pairings that are valid now
	 *
	 * @returns {Promise<{id: string, origin: string, created: string, used: string, expires: string}[]>}
	 */
	async list() {
		return (await this.#request('GET', '/pairings')).pairings;
	}

	/**
	 * Ends one pairing, or every pairing without an identifier; the streams it opened end at once
	 *
	 * @param {string} [id]
	 * @throws {ContractError} `PAIRING_NOT_FOUND` for an identifier no valid pairing has
	 */
	async revoke(id) {
		await this.#request('DELETE', id === undefined ? '/pairings' : `/pairings/${encodeURIComponent(id)}`);
	}
}
