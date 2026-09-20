/**
 * What the preview validations need of a browser and of a CDN. Nothing here imports Packages, so a
 * validation that runs an installed toolchain uses it from a plain Node process.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const listening = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));

/**
 * Stands in for the CDN: it answers the paths of the compiled-module contract it was given, with the
 * cross-origin header a browser requires of a module of another origin. It is not CDN delivery.
 */
export class Origin {
	#server;
	#modules = new Map();

	origin;
	requests = [];

	module(path, code) {
		this.#modules.set(path, code);
		return this;
	}

	async start() {
		this.#server = createServer((incoming, outgoing) => {
			const { pathname, search } = new URL(incoming.url, 'http://cdn');
			this.requests.push(`${pathname}${search}`);
			const code = this.#modules.get(pathname);
			const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/javascript; charset=utf-8' };
			code === void 0 ? outgoing.writeHead(404, headers).end() : outgoing.writeHead(200, headers).end(code);
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
