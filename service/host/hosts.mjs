/**
 * Which `Host` a request may name, which is how a service on the loopback address refuses DNS rebinding: a site
 * whose name was made to resolve to this machine sends its own name, never a loopback one. Every service checks it,
 * on every request, whether it pairs browsers or not.
 *
 * On a loopback bind, a request names a loopback name (`127.0.0.1`, `localhost`, `[::1]`) with the port it arrived
 * on, or the public host that port is reached through when it has one (an external server behind a forwarder, such
 * as a Codespaces port). Behind any other address something else decides who reaches the service, and the name is
 * not checked.
 *
 * ```js
 * const hosts = new Hosts({ bind: '127.0.0.1' });
 * hosts.setup(app);                                          // 403 HOST_REFUSED before every route
 * hosts.expose(4000, 'https://name-4000.app.github.dev');   // the public origin of a port
 * hosts.allows('localhost:4000', 4000);                      // true
 * ```
 */
export class Hosts {
	static #LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
	static #NAMES = ['127.0.0.1', 'localhost', '[::1]'];
	static #HOST = /^[\w.\-:[\]]+$/;

	#loopback;
	#exposed = new Map();

	/**
	 * @param {{bind?: string}} [options] The address the service listens on, the loopback one by default
	 */
	constructor({ bind } = {}) {
		this.#loopback = Hosts.#LOOPBACK.includes(bind ?? '127.0.0.1');
	}

	/**
	 * Whether a bind address is a loopback one
	 *
	 * @param {string} [bind]
	 */
	static loopback(bind) {
		return Hosts.#LOOPBACK.includes(bind ?? '127.0.0.1');
	}

	/**
	 * Whether the service listens on a loopback address, where names are checked
	 */
	get loopback() {
		return this.#loopback;
	}

	/**
	 * Names the public origin a port is reached through, whose host requests to that port may also name
	 *
	 * @param {number} port
	 * @param {string | undefined} origin
	 */
	expose(port, origin) {
		origin ? this.#exposed.set(port, new URL(origin)) : this.#exposed.delete(port);
	}

	/**
	 * The public origin of a port, when it has one
	 *
	 * @param {number} port
	 * @returns {string | undefined}
	 */
	public(port) {
		return this.#exposed.get(port)?.origin;
	}

	/**
	 * Whether a request names a loopback host with its port: it was addressed to this machine, not through a public
	 * name. On a bind that is not a loopback one nothing is.
	 *
	 * @param {unknown} header The `Host` header of a request
	 * @param {number} port The local port the request arrived on
	 */
	local(header, port) {
		if (!this.#loopback) return false;
		const host = String(header ?? '');
		if (!Hosts.#HOST.test(host)) return false;
		try {
			const url = new URL(`http://${host}`);
			return Hosts.#NAMES.includes(url.hostname) && Number(url.port || 80) === port;
		} catch {
			return false;
		}
	}

	/**
	 * @param {unknown} header The `Host` header of a request
	 * @param {number} port The local port the request arrived on
	 */
	allows(header, port) {
		if (!this.#loopback) return true;
		const host = String(header ?? '').toLowerCase();
		const exposed = this.#exposed.get(port);
		if (exposed && Hosts.#HOST.test(host) && host === exposed.host.toLowerCase()) return true;
		return this.local(header, port);
	}

	/**
	 * The origin a browser request was sent from when it carries no `Origin`, which a browser omits on a GET of its
	 * own origin (`Sec-Fetch-Site: same-origin`): the origin it addressed, as its `Host` names it, with the scheme of the
	 * public origin of the port when that is the host it named (a forwarder that ends TLS does not pass it on)
	 *
	 * @param {unknown} header The `Host` header
	 * @param {number} port The local port the request arrived on
	 */
	origin(header, port) {
		const host = String(header ?? '').toLowerCase();
		if (!Hosts.#HOST.test(host)) return;
		const exposed = this.#exposed.get(port);
		if (exposed && exposed.host.toLowerCase() === host) return exposed.origin;
		try {
			return new URL(`http://${host}`).origin;
		} catch {
			return;
		}
	}

	/**
	 * Whether an `Origin` is the origin a request was addressed to: HTTP or HTTPS (a gateway in front may end TLS) with
	 * the host its `Host` header names
	 *
	 * @param {unknown} origin The `Origin` header
	 * @param {unknown} host The `Host` header
	 */
	static same(origin, host) {
		try {
			const url = new URL(String(origin));
			return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === String(host ?? '').toLowerCase();
		} catch {
			return false;
		}
	}

	/**
	 * Mounts the check before every route: a request that names another host is `403 HOST_REFUSED`, preflights and
	 * local processes included
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		if (!this.#loopback) return;
		app.use((request, response, next) => {
			if (this.allows(request.headers.host, request.socket.localPort)) return next();
			const message = `This service only accepts requests addressed to a loopback name (127.0.0.1, localhost or [::1]) with its own port, or to its public host, and this one names "${request.headers.host ?? ''}"`;
			response.status(403).set('cache-control', 'no-store').json({ error: { code: 'HOST_REFUSED', message } });
		});
	}
}
