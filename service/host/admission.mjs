/**
 * Whether a request that changes the workspace may run, whoever sends it. The service has no authentication of
 * its own and listens on the loopback address by default, so a page of any site the developer opens could reach
 * it: such a request is refused before anything runs.
 *
 * - Its options are a JSON document sent as `Content-Type: application/json`. A page cannot send that type
 *   without asking first (a preflight), which the service never allows another origin; any other type, an
 *   empty body included, is refused (`415`).
 * - A request with an `Origin` is accepted only from the origin it was addressed to (`403`): a command line
 *   sends none, and a page of another site always sends its own.
 * - On the loopback address, the `Host` it names is a loopback name with the port the request arrived on
 *   (`403`): a site whose name was made to resolve to this machine (DNS rebinding) names itself. Behind another
 *   address something else decides who reaches the service, and the name is not checked.
 *
 * ```js
 * const admission = new Admission({ bind: '127.0.0.1' });
 * const refusal = admission.refusal(request);   // undefined, or {status, error: {code, message}}
 * ```
 */
export class Admission {
	static #LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
	static #NAMES = ['127.0.0.1', 'localhost', '[::1]'];

	#loopback;

	/**
	 * @param {{bind?: string}} [options] The address the service listens on, the loopback one by default
	 */
	constructor({ bind } = {}) {
		this.#loopback = Admission.#LOOPBACK.includes(bind ?? '127.0.0.1');
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
		if (this.#loopback && !Admission.#local(host, request.socket.localPort)) {
			const message = `This service only accepts changes addressed to a loopback name (127.0.0.1, localhost or [::1]) with its own port, and the request names "${host}"`;
			return { status: 403, error: { code: 'HOST_REFUSED', message } };
		}

		const { origin } = request.headers;
		if (origin !== undefined && !Admission.#same(origin, host)) {
			const message = `A page of another origin (${origin}) cannot change this workspace`;
			return { status: 403, error: { code: 'ORIGIN_REFUSED', message } };
		}
	}

	/**
	 * Whether a `Host` header names a loopback name with the port the request arrived on. A value with anything
	 * but a name and a port (a user, a path) is not a host.
	 */
	static #local(host, port) {
		if (!/^[\w.\-:[\]]+$/.test(host)) return false;
		try {
			const url = new URL(`http://${host}`);
			return Admission.#NAMES.includes(url.hostname) && Number(url.port || 80) === port;
		} catch {
			return false;
		}
	}

	/**
	 * Whether an `Origin` is the origin the request was addressed to: its scheme is HTTP or HTTPS (a gateway in
	 * front may end TLS) and its host is the one of the `Host` header
	 */
	static #same(origin, host) {
		try {
			const url = new URL(origin);
			return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === host.toLowerCase();
		} catch {
			return false;
		}
	}
}
