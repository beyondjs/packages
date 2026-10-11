import { Hosts } from './hosts.mjs';
import { Scope } from './pairing/scope.mjs';

/**
 * What a page of another origin reaches on a loopback service that does not pair browsers and verifies no delegated
 * grant, as `beyond test` and `beyond install` start it (and Conduict's runner, behind its development proxy). Such a
 * service has no authentication, so a page of any site the developer opens could otherwise use it while it runs:
 *
 * - A change (any method but `GET`, `HEAD` and `OPTIONS`) sent with an `Origin` other than the one it was addressed to
 *   is `403 ORIGIN_REFUSED`: a page sends its own `Origin` on every such request, even one without a body, which needs
 *   no preflight (`POST /builds`, `POST /builds/:id/cancel`); a process sends none, and Conduict's proxy sends the
 *   service's own.
 * - An attachment (`GET /attach`), which keeps the service alive, is refused the same way to a page of another origin,
 *   told by its `Origin` or, for a request that carries none (an image, a classic script), by a `Sec-Fetch-Site` other
 *   than `same-origin` or `none`.
 * - The compiled-module routes answer with their `Access-Control-Allow-Origin: *` only a request without an `Origin`,
 *   one of the service's own origin, and one of an embed origin (`BEYOND_EMBED_ORIGINS`, origins separated by commas,
 *   or `*` for every origin as before): a page of any other origin reads nothing of them, a preflight included. Their
 *   answers vary by `Origin`.
 *
 * ```js
 * new SameOrigin({ environment: process.env }).setup(app);   // before every route but the `Host` check
 * ```
 */
export class SameOrigin {
	static VARIABLE = 'BEYOND_EMBED_ORIGINS';
	static #SAFE = ['GET', 'HEAD', 'OPTIONS'];

	#embeds;

	/**
	 * @param {{environment?: Record<string, string | undefined>}} [options] Where `BEYOND_EMBED_ORIGINS` is read
	 * @throws {Error} For a value that is neither `*` nor a list of http or https origins, which fails the start
	 */
	constructor({ environment = process.env } = {}) {
		this.#embeds = SameOrigin.#parse(environment[SameOrigin.VARIABLE]);
	}

	static #parse(value) {
		const values = String(value ?? '').split(',').map(one => one.trim()).filter(Boolean);
		if (values.includes('*')) return '*';
		return new Set(values.map(one => {
			let url;
			try {
				url = new URL(one);
			} catch {
				// Reported below
			}
			if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== one.replace(/\/$/, '')) {
				throw new Error(`${SameOrigin.VARIABLE} names "${one}", which is neither "*" nor an http or https origin`);
			}
			return url.origin;
		}));
	}

	/**
	 * Whether a request was sent by a page of another origin than the one it addressed
	 *
	 * @param {import('node:http').IncomingMessage} request
	 */
	static foreign(request) {
		const { origin, host } = request.headers;
		if (origin !== undefined) return !Hosts.same(origin, host);
		const site = request.headers['sec-fetch-site'];
		return site !== undefined && site !== 'same-origin' && site !== 'none';
	}

	/**
	 * Whether a page of an origin reads the answers of the compiled-module routes
	 *
	 * @param {string} origin
	 */
	reads(origin) {
		return this.#embeds === '*' || this.#embeds.has(origin);
	}

	/**
	 * Takes the cross-origin headers out of an answer, when they are written, for a page that may not read it
	 */
	#final(response) {
		const write = response.writeHead;
		response.writeHead = function (...args) {
			response.removeHeader('access-control-allow-origin');
			response.removeHeader('access-control-expose-headers');
			return write.apply(this, args);
		};
	}

	/**
	 * Mounts the rules before every route but the `Host` check
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.use((request, response, next) => {
			const change = !SameOrigin.#SAFE.includes(request.method);
			const attach = Scope.normalized(request.path) === '/attach';
			if ((change || attach) && SameOrigin.foreign(request)) {
				const named = request.headers.origin ?? `a page of another site (Sec-Fetch-Site: ${request.headers['sec-fetch-site']})`;
				const message = `A page of another origin (${named}) cannot ${attach ? 'attach to' : 'change'} this development service`;
				return response.status(403).set('cache-control', 'no-store').json({ error: { code: 'ORIGIN_REFUSED', message } });
			}
			if (Scope.compiled(request.path)) {
				response.vary('Origin');
				const { origin } = request.headers;
				origin !== undefined && !Hosts.same(origin, request.headers.host) && !this.reads(origin) && this.#final(response);
			}
			next();
		});
	}
}
