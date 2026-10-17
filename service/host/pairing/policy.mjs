import { timingSafeEqual } from 'node:crypto';
import { Caller } from './caller.mjs';
import { Forwarding } from './forwarding.mjs';
import { Scope } from './scope.mjs';
import { Sites } from './sites.mjs';

/**
 * The access policy of a service that pairs browsers, mounted before every route (after the `Host` check every
 * service makes, and after the cross-origin rules that answer the preflights of its interface origins).
 *
 * **The preview listener** answers `GET` and `HEAD` of what a preview page loads (`Scope.preview`) and nothing else
 * (`404 NOT_FOUND`); a page of another site that is not an allowed origin is `403 SITE_REFUSED` unless it navigates
 * (`Sites`); a compiled module, a map or an update that names a target other than `browser`, and a resolution document
 * for any target but `browser`, are `403 TARGET_REFUSED` (`Scope.foreign`): stylesheets and declared assets are the same
 * for every target. Its callers are previewers: they read compiled modules and build events, never a source.
 *
 * **The API listener** tells its callers apart (see `Caller`): the local credential in `Authorization: Local` is a
 * local tool, a valid token in `Authorization: Bearer` from its origin is a paired page, a process of this machine
 * without either is a local consumer (no `Origin` nor `Sec-Fetch-Site`, a loopback remote address and `Host`, no header
 * of a proxy or a tunnel (`Forwarding`), and no public origin configured), and anyone else a visitor. A consumer reads
 * (`Scope.reads`) and is refused anything else with `401 CREDENTIAL_REQUIRED`; a visitor pairs a page and loads the
 * interface (`Scope.visitor`) and is refused anything else with `401 PAIRING_REQUIRED`, `PAIRING_EXPIRED`,
 * `PAIRING_REVOKED`, `403 PAIRING_ORIGIN`, or `401 CREDENTIAL_REQUIRED` when it is not a browser.
 *
 * The decision is left on the request (`Caller`), so a route that checks a capability itself, as the development
 * extension does, reads the same one.
 */
export class Policy {
	static #LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

	#hosts;
	#pairings;
	#credential;
	#previews;
	#preview;
	#exposed = false;

	/**
	 * @param {import('../hosts.mjs').Hosts} hosts The names requests may address
	 * @param {import('./pairings.mjs').Pairings} pairings
	 * @param {{credential: string, previews?: (origin: string) => boolean}} options The local credential of the service,
	 * and the origins whose pages the preview listener serves across sites
	 */
	constructor(hosts, pairings, { credential, previews = () => false }) {
		this.#hosts = hosts;
		this.#pairings = pairings;
		this.#credential = Buffer.from(String(credential));
		this.#previews = previews;
	}

	/**
	 * The service listens: the port of its preview listener, and whether it is reached through a public origin,
	 * behind which nobody is a local consumer
	 *
	 * @param {{preview: number, exposed: boolean}} listening
	 */
	listen({ preview, exposed }) {
		this.#preview = preview;
		this.#exposed = exposed;
	}

	/**
	 * Whether a request arrived on the preview listener
	 *
	 * @param {import('node:http').IncomingMessage} request
	 */
	previewing(request) {
		return this.#preview !== undefined && request.socket.localPort === this.#preview;
	}

	/**
	 * Whether a request comes from a browser
	 *
	 * @param {import('node:http').IncomingMessage} request
	 */
	static browser(request) {
		return request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined;
	}

	/**
	 * The origin a browser request was sent from: its `Origin`, or the origin it addressed when it is a request of a
	 * page to its own origin, which a browser sends without one; undefined when it cannot be told
	 */
	#origin(request) {
		const { origin } = request.headers;
		if (origin !== undefined) return origin === 'null' ? void 0 : origin;
		if (request.headers['sec-fetch-site'] === 'same-origin') return this.#hosts.origin(request.headers.host, request.socket.localPort);
	}

	#local(value) {
		const presented = Buffer.from(String(value));
		return presented.length === this.#credential.length && timingSafeEqual(presented, this.#credential);
	}

	/**
	 * Who sent a request to the API listener
	 *
	 * @param {import('node:http').IncomingMessage} request
	 * @returns {Caller}
	 */
	caller(request) {
		const [, scheme, value] = /^(\w+)\s+(\S+)$/.exec(String(request.headers.authorization ?? '')) ?? [];
		const browser = Policy.browser(request);
		if (!browser && scheme?.toLowerCase() === 'local') {
			if (this.#local(value)) return new Caller('local');
			return new Caller('visitor', { refusal: { ...Caller.CREDENTIAL, message: 'This credential is not the local credential of this development service' } });
		}
		if (browser) {
			if (scheme?.toLowerCase() !== 'bearer') return new Caller('visitor');
			const { refusal, ...verified } = this.#pairings.verify(value, this.#origin(request));
			return refusal ? new Caller('visitor', { refusal }) : new Caller('paired', verified);
		}

		const forwarded = Forwarding.of(request.headers);
		if (forwarded) {
			const message = `This request came through a proxy or a tunnel (${forwarded}), which is never a process of this machine: it needs the local credential or a token. A port forwarded to another machine needs the service started with its public origin (--public-origin) and its pages paired`;
			return new Caller('visitor', { refusal: { ...Caller.CREDENTIAL, message } });
		}
		const loopback = Policy.#LOOPBACK.includes(request.socket.remoteAddress ?? '');
		const local = loopback && !this.#exposed && this.#hosts.local(request.headers.host, request.socket.localPort);
		return new Caller(local ? 'consumer' : 'visitor', { refusal: Caller.CREDENTIAL });
	}

	static #refuse(response, { status, code, message }) {
		response.status(status).set('cache-control', 'no-store').json({ error: { code, message } });
	}

	/**
	 * Decides a request of the preview listener; true when it was answered here
	 */
	#previewer(request, response) {
		new Caller('previewer', { refusal: { status: 404, code: 'NOT_FOUND', message: 'The preview listener serves previews only' } }).attach(request);
		if (!Scope.preview(request.method, request.path)) {
			Policy.#refuse(response, { status: 404, code: 'NOT_FOUND', message: `The preview listener does not serve "${request.path}": it serves previews, compiled modules and build events only` });
			return true;
		}
		const refusal = Sites.refusal(request, { allows: this.#previews, exposed: this.#exposed });
		if (refusal) {
			Policy.#refuse(response, refusal);
			return true;
		}
		if (Scope.foreign(request)) {
			Policy.#refuse(response, { status: 403, code: 'TARGET_REFUSED', message: 'The preview listener delivers code and resolution documents to browsers only (target=browser)' });
			return true;
		}
		return false;
	}

	/**
	 * Mounts the decision of who sent each request, and the refusal of what that caller does not reach
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.use((request, response, next) => {
			if (this.previewing(request)) return this.#previewer(request, response) || next();

			const caller = this.caller(request);
			caller.attach(request);
			const { kind } = caller;
			const reached =
				request.method === 'OPTIONS' ||
				kind === 'local' ||
				kind === 'paired' ||
				(kind === 'consumer' && Scope.reads(request.method, request.path)) ||
				Scope.visitor(request.method, request.path);
			if (reached) return next();
			Policy.#refuse(response, caller.refusal('files.write') ?? Caller.CREDENTIAL);
		});
	}
}
