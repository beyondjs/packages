import { existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import express from 'express';

/**
 * The Packages interface a service serves at `/ui/` as its fallback: the static build the toolchain installation
 * carries (or another one its client names), the version shipped with this service and therefore compatible with it.
 * It pairs like any page, from the service's own origin, and holds no Beyond session.
 *
 * - A file of the build is served with its media type and `X-Content-Type-Options: nosniff`; a file under `assets/`,
 *   whose name a build hashes, is cached for a year, anything else is revalidated (`no-cache`).
 * - A path that names no file and has no extension is a route of the application: it answers `index.html`. A missing
 *   file with an extension is `404`, never the page, and no directory is ever listed.
 * - The page is sent with a content security policy for a static application: scripts, styles, fonts, workers and
 *   connections of its own origin only (inline styles allowed), images also from `data:` and `blob:`, frames of its own
 *   origin, no plugins, no form targets and no framing by another page.
 *
 * ```js
 * new Interface('/path/to/ui').setup(app);   // GET /ui → /ui/, GET /ui/… → the build
 * ```
 */
export class Interface {
	static PATH = '/ui';

	static POLICY = [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"worker-src 'self' blob:",
		"connect-src 'self'",
		"frame-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'none'",
		"frame-ancestors 'none'"
	].join('; ');

	#directory;

	/**
	 * @param {string} directory The static build: a directory with an `index.html`
	 * @throws {Error} When it is not one, which fails the start of a service that was asked to serve it
	 */
	constructor(directory) {
		const index = join(String(directory), 'index.html');
		if (!existsSync(index) || !statSync(index).isFile()) {
			throw new Error(`The interface directory "${directory}" holds no index.html`);
		}
		this.#directory = directory;
	}

	/**
	 * What `/session` lists for the interface
	 */
	get capabilities() {
		return { ui: 1 };
	}

	static #headers(response, path) {
		response.setHeader('x-content-type-options', 'nosniff');
		response.setHeader('referrer-policy', 'no-referrer');
		const asset = /[\\/]assets[\\/]/.test(path);
		response.setHeader('cache-control', asset ? 'public, max-age=31536000, immutable' : 'no-cache');
		if (extname(path) === '.html') response.setHeader('content-security-policy', Interface.POLICY);
	}

	/**
	 * Mounts the interface. Mount it before the compiled-module routes, whose cross-origin headers it does not use.
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		// The addresses of the build are relative to the page, so the page only exists with the slash
		app.get(Interface.PATH, (request, response, next) => {
			if (request.path.endsWith('/')) return next();
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?')) : '';
			response.redirect(308, `ui/${query}`);
		});

		const files = express.static(this.#directory, {
			index: false,
			redirect: false,
			dotfiles: 'ignore',
			fallthrough: true,
			setHeaders: (response, path) => Interface.#headers(response, path)
		});
		app.use(Interface.PATH, (request, response, next) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') return next();
			files(request, response, () => this.#page(request, response, next));
		});
	}

	/**
	 * Answers the page for a route of the application, and nothing for a file that is not there
	 */
	#page(request, response, next) {
		if (extname(request.path)) {
			response.status(404).set('cache-control', 'no-store').json({ error: { code: 'NOT_FOUND', message: `The interface has no file "${request.path}"` } });
			return;
		}
		Interface.#headers(response, join(this.#directory, 'index.html'));
		// Relative to the build's root: an installation under a dot directory (`~/.local/share/beyond-cli`) is not a
		// dot file of the request, and only the request's own path is checked
		response.sendFile('index.html', { root: this.#directory, dotfiles: 'deny' }, error => error && next(error));
	}
}
