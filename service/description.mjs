import { ContractError, Session } from '@beyond-js/artifact-api';
import { AccessError, TimeoutError, Transport } from './errors.mjs';

/**
 * The description a running service gives of itself (`GET /session`), as a client reads it before using the
 * service: the host composes it (`host/description.mjs`), a client checks it here against the workspace and the
 * toolchain it expects.
 *
 * What answers at the address of a record decides what the record is:
 *
 * - nothing accepts the connection, or something answers that is not that service: a stale record;
 * - the service refuses this client (401, 403): it is there, and the client has no access (`AccessError`);
 * - the service answers too late: it is there and slow (`TimeoutError`);
 * - the service answers that it cannot describe itself now (a 5xx or 429): it is there and unavailable
 *   (`ContractError` `UNAVAILABLE`), as the bounded-waits convention says of a 5xx. It is never taken for a
 *   service that ended, which would discard its record and start a second one beside it.
 */
export class Description {
	/**
	 * @param {{origin: string, pid?: number}} record Where a service is said to be
	 * @param {{root: string, toolchain: string}} expected What the service must be serving
	 * @param {{headers?: Record<string, string>, deadline: number}} options The access context of a service whose
	 * host guards its routes, and the milliseconds the description is waited for, body included
	 * @returns {Promise<Session | undefined>} The session of the expected service, undefined for a stale record
	 * @throws {AccessError} `SERVICE_ACCESS_REFUSED`
	 * @throws {TimeoutError} `SERVICE_NOT_ANSWERING`
	 * @throws {ContractError} `UNAVAILABLE`
	 */
	static async read(record, expected, { headers = {}, deadline }) {
		let response, text;
		try {
			response = await fetch(`${record.origin}${Session.PATH}`, { headers, signal: AbortSignal.timeout(deadline) });
			text = await response.text();
		} catch (error) {
			// Nothing answering is a stale record; answering too late is a live service, and saying so is
			// what keeps a loaded host from losing the service it already has
			if (Transport.expired(error)) throw new TimeoutError(record.origin, deadline);
			return;
		}

		if ([401, 403].includes(response.status)) {
			throw new AccessError(`The development service at ${record.origin} refused access (HTTP ${response.status})`);
		}
		if (response.status >= 500 || response.status === 429) throw Description.#unavailable(record.origin, response.status, text);
		if (!response.ok) return;

		let session;
		try {
			session = new Session(JSON.parse(text));
		} catch {
			// Something answers there that is not a development service
			return;
		}
		const same = session.workspace.root === expected.root && session.service.toolchain === expected.toolchain;
		if (!same || (record.pid && session.service.pid !== record.pid)) return;
		return session;
	}

	/**
	 * A service that answered that it cannot describe itself now, with the reason it gave when it gave one
	 */
	static #unavailable(origin, status, text) {
		let reported;
		try {
			reported = ContractError.from(status, JSON.parse(text));
		} catch {
			// An answer that is not a document of the service: its status says enough
		}
		const reason = reported?.message ? `: ${reported.message}` : '';
		const message = `The development service at ${origin} is running and cannot describe itself now (HTTP ${status})${reason}`;
		return new ContractError('UNAVAILABLE', message, { status });
	}
}
