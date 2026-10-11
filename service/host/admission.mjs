import { Hosts } from './hosts.mjs';
import { Caller } from './pairing/caller.mjs';

/**
 * Whether a request that changes the workspace may run, whoever sends it. The service has no authentication of
 * its own and listens on the loopback address by default, so a page of any site the developer opens could reach
 * it: such a request is refused before anything runs.
 *
 * - Its options are a JSON document sent as `Content-Type: application/json`. A page cannot send that type
 *   without asking first (a preflight), which the service never allows another origin; any other type, an
 *   empty body included, is refused (`415`).
 * - A request with an `Origin` is accepted only from the origin it was addressed to (`403`): a command line
 *   sends none, and a page of another site always sends its own. On a service that pairs browsers, a page that
 *   presents its pairing from the origin it was paired from is accepted as well (see `Caller`).
 * - On the loopback address, the `Host` it names is a loopback name with the port the request arrived on, or the
 *   host of the service's public origin (`403`): a site whose name was made to resolve to this machine (DNS
 *   rebinding) names itself. Behind another address something else decides who reaches the service, and the name is
 *   not checked (see `Hosts`).
 *
 * ```js
 * const admission = new Admission({ bind: '127.0.0.1' });
 * const refusal = admission.refusal(request);   // undefined, or {status, error: {code, message}}
 * ```
 */
export class Admission {
	#hosts;

	/**
	 * @param {{bind?: string, hosts?: Hosts}} [options] The address the service listens on, the loopback one by
	 * default, or the names requests may address, shared with the rest of the service
	 */
	constructor({ bind, hosts = new Hosts({ bind }) } = {}) {
		this.#hosts = hosts;
	}

	/**
	 * Why a request that changes the workspace is refused, or undefined when it may run
	 *
	 * @param {import('node:http').IncomingMessage} request
	 * @returns {{status: number, error: {code: string, message: string}} | undefined}
	 */
	refusal(request) {
		const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
		if (type !== 'application/json') {
			const message = `A request that changes the workspace is sent as Content-Type: application/json (it was ${type ? `"${type}"` : 'sent without one'})`;
			return { status: 415, error: { code: 'CONTENT_TYPE_UNSUPPORTED', message } };
		}

		const host = String(request.headers.host ?? '');
		if (!this.#hosts.allows(host, request.socket.localPort)) {
			const message = `This service only accepts changes addressed to a loopback name (127.0.0.1, localhost or [::1]) with its own port, and the request names "${host}"`;
			return { status: 403, error: { code: 'HOST_REFUSED', message } };
		}

		const { origin } = request.headers;
		const paired = Caller.of(request)?.kind === 'paired';
		if (origin !== undefined && !paired && !Hosts.same(origin, host)) {
			const message = `A page of another origin (${origin}) cannot change this workspace`;
			return { status: 403, error: { code: 'ORIGIN_REFUSED', message } };
		}
	}
}
