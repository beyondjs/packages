/**
 * What the preview validations need of a browser and of a CDN. Nothing here imports Packages, so a
 * validation that runs an installed toolchain uses it from a plain Node process.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const listening = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));

/**
 * Stands in for the CDN: it answers the paths of the compiled-module contract it was given, with the
 * cross-origin header a browser requires of a module of another origin and the strong entity tag
 * (`sha256-<hex>` of the bytes) the CDN answers, to `GET` and to `HEAD`. It is not CDN delivery.
 *
 * `requests` lists what was retrieved and `checked` what was asked with `HEAD`. While `silent` is set it answers
 * nothing, as a CDN that does not respond; its pending requests end when it stops. A path can be given an answer a
 * CDN of the contract would not give, to see it refused: without the entity tag (`untagged`), with another media
 * type (`type`), or as a redirect (`redirect`).
 */
export class Origin {
	#server;
	#modules = new Map();
	#answers = new Map();

	origin;
	requests = [];
	checked = [];
	silent = false;

	/**
	 * @param answer What the path answers instead of the contract's answer: `{untagged: true}`, `{type}` or `{redirect}`
	 */
	module(path, code, answer = {}) {
		this.#modules.set(path, code);
		this.#answers.set(path, answer);
		return this;
	}

	/**
	 * Stops answering for a path, as a CDN that does not hold its output
	 */
	forget(path) {
		this.#modules.delete(path);
		return this;
	}

	async start() {
		this.#server = createServer((incoming, outgoing) => {
			const { pathname, search } = new URL(incoming.url, 'http://cdn');
			(incoming.method === 'HEAD' ? this.checked : this.requests).push(`${pathname}${search}`);
			if (this.silent) return;

			const code = this.#modules.get(pathname);
			const answer = this.#answers.get(pathname) ?? {};
			const headers = { 'access-control-allow-origin': '*', 'content-type': answer.type ?? 'application/javascript; charset=utf-8' };
			if (code === void 0) return void outgoing.writeHead(404, headers).end();
			if (answer.redirect) return void outgoing.writeHead(302, { ...headers, location: answer.redirect }).end();
			!answer.untagged && (headers.etag = `"sha256-${createHash('sha256').update(code).digest('hex')}"`);
			incoming.method === 'HEAD' ? outgoing.writeHead(200, headers).end() : outgoing.writeHead(200, headers).end(code);
		});
		this.origin = await listening(this.#server);
		return this;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}
}

/**
 * A headless browser driven through `playwright-core`, which this repository does not declare: the
 * validation resolves it from `BEYOND_PLAYWRIGHT`, a directory with it installed, and uses the installed
 * Chrome (`BEYOND_BROWSER_CHANNEL` names another channel).
 */
export class Browser {
	#browser;

	async start() {
		const { BEYOND_PLAYWRIGHT, BEYOND_BROWSER_CHANNEL: channel = 'chrome' } = process.env;
		if (!BEYOND_PLAYWRIGHT) throw new Error('Set BEYOND_PLAYWRIGHT to a directory where "playwright-core" is installed.');

		const base = pathToFileURL(join(resolve(BEYOND_PLAYWRIGHT), 'package.json')).href;
		const { chromium } = createRequire(base)('playwright-core');
		this.#browser = await chromium.launch({ channel, headless: true });
		return this;
	}

	get version() {
		return this.#browser.version();
	}

	/**
	 * @returns A page that records what a reload or a failure would leave behind
	 */
	async page() {
		const page = await this.#browser.newPage();
		const observed = { errors: [], refused: [], navigations: [] };
		page.on('pageerror', error => observed.errors.push(error.message));
		page.on('console', message => message.type() === 'error' && observed.errors.push(message.text()));
		page.on('response', response => response.status() >= 400 && !response.url().endsWith('/favicon.ico') && observed.refused.push(`${response.status()} ${response.url()}`));
		page.on('framenavigated', frame => frame === page.mainFrame() && observed.navigations.push(frame.url()));
		return { page, observed };
	}

	stop() {
		return this.#browser?.close();
	}
}
