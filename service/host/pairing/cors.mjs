/**
 * Who reads the answers of a service that pairs browsers from another origin: an allowed origin of the listener a
 * request arrived on, and nobody else. Never `*`.
 *
 * - On the API listener: the allowed interface origins (its own origin, where its fallback interface runs, the
 *   configured Packages interface, the `--ui` origins, the origins an outstanding code names and those of valid
 *   pairings). Never the preview origin.
 * - On the preview listener: its own origin, the allowed interface origins and the embed origins
 *   (`BEYOND_EMBED_ORIGINS`, `--embed`), which import its compiled modules into pages of their own.
 *
 * For an allowed origin a preflight is answered here, with that origin, the methods and headers a client sends,
 * `Access-Control-Max-Age: 600`, `Access-Control-Allow-Private-Network: true` when the browser asks for it, and
 * `Vary: Origin`. Every answer is given its cross-origin headers when its headers are written, whatever a route set or
 * removed before: the allowed origin with `Vary: Origin` and the exposed headers, or none at all, so the
 * `Access-Control-Allow-Origin: *` of the compiled-module routes never leaves a service that pairs. No credentials
 * mode is used: the token travels in `Authorization`.
 */
export class Cors {
	static METHODS = 'GET, PUT, POST, DELETE';
	static HEADERS = 'authorization, content-type, if-match, if-none-match, last-event-id';
	static EXPOSED = 'etag, beyond-cursor, location, sourcemap, link';
	static AGE = '600';

	#allows;

	/**
	 * @param {(origin: string, request: import('node:http').IncomingMessage) => boolean} allows Whether an origin may
	 * read the answers of the listener a request arrived on
	 */
	constructor(allows) {
		this.#allows = allows;
	}

	/**
	 * Adds a value to the `Vary` of an answer, once
	 */
	static #vary(response, value) {
		const current = String(response.getHeader('vary') ?? '');
		const values = current.split(',').map(one => one.trim()).filter(Boolean);
		if (!values.some(one => one.toLowerCase() === value.toLowerCase())) values.push(value);
		response.setHeader('vary', values.join(', '));
	}

	static #preflight(request, response, origin) {
		response.setHeader('access-control-allow-origin', origin);
		response.setHeader('access-control-allow-methods', Cors.METHODS);
		response.setHeader('access-control-allow-headers', Cors.HEADERS);
		response.setHeader('access-control-max-age', Cors.AGE);
		if (String(request.headers['access-control-request-private-network']).toLowerCase() === 'true') {
			response.setHeader('access-control-allow-private-network', 'true');
		}
		Cors.#vary(response, 'Origin');
		response.status(204).end();
	}

	/**
	 * Gives the answer its cross-origin headers when they are written, whatever was set or removed before
	 */
	static #final(response, origin) {
		const write = response.writeHead;
		response.writeHead = function (...args) {
			if (origin) {
				response.setHeader('access-control-allow-origin', origin);
				response.setHeader('access-control-expose-headers', Cors.EXPOSED);
			} else {
				response.removeHeader('access-control-allow-origin');
				response.removeHeader('access-control-expose-headers');
			}
			Cors.#vary(response, 'Origin');
			return write.apply(this, args);
		};
	}

	/**
	 * Mounts the cross-origin rules, before every route but the `Host` check
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.use((request, response, next) => {
			const { origin } = request.headers;
			const allowed = origin !== undefined && origin !== 'null' && this.#allows(origin, request);
			const preflight = request.method === 'OPTIONS' && request.headers['access-control-request-method'] !== undefined;
			if (preflight && allowed) return Cors.#preflight(request, response, origin);
			Cors.#final(response, allowed ? origin : void 0);
			next();
		});
	}
}
