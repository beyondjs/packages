import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, PairingClient, Service } from '@beyond-js/packages/service';

export const DEVELOPMENT = '@beyond-js/packages/development';
export const JSON_TYPE = { 'content-type': 'application/json' };

/**
 * The sources of the development runtime, `BEYOND_RUNTIME` or the suite's `local-2026` beside this repository: its
 * manifest and the directory of each module it exports, which is what a copy of the package needs
 */
const runtime = () => {
	const sibling = ['../../../../../local-2026', '../../../../local-2026'].map(path => fileURLToPath(new URL(path, import.meta.url))).find(path => existsSync(path));
	const root = resolve(process.env.BEYOND_RUNTIME || sibling || fileURLToPath(new URL('../../../../../local-2026', import.meta.url)));
	if (!existsSync(join(root, 'bundle/index.ts'))) throw new Error(`The development runtime was not found in ${root}. Set BEYOND_RUNTIME.`);
	const { exports } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const entries = ['package.json', ...new Set(Object.values(exports).map(target => String(target).replace(/^\.\//, '').split('/')[0]))];
	return { root, entries: entries.filter(entry => existsSync(join(root, entry))) };
};

/**
 * The real development service of a copy of a fixture of `tests/applications/fixtures`, started from this checkout as
 * the command line starts it: through `@beyond-js/packages/service`, whose supervisor prepares Packages with the
 * bootstrap Engine and starts the host with the development extension and, unless a case says otherwise, pairing. This
 * process holds it as its owner and is a local tool: its requests present the local credential.
 *
 * ```js
 * const served = await new Served('workspace').start();
 * await served.send('GET', '/applications', { headers: served.headers });
 * await served.stop();
 * ```
 */
export class Served {
	#fixture;
	#parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond applications ')));
	#root = join(this.#parent, 'workspace');
	#home = join(this.#parent, 'home');
	#connection;
	#attachment;

	/**
	 * @param {string} fixture The directory of `fixtures/` the workspace is copied from
	 */
	constructor(fixture) {
		this.#fixture = fileURLToPath(new URL(`../fixtures/${fixture}`, import.meta.url));
	}

	/**
	 * The canonical root of the copy, and the directory beside it that is outside the workspace
	 */
	get root() {
		return this.#root;
	}

	get outside() {
		return this.#parent;
	}

	get origin() {
		return this.#connection.origin;
	}

	get session() {
		return this.#connection.session.toJSON();
	}

	/**
	 * The access context of a local tool: the local credential of a service that pairs
	 */
	get headers() {
		return this.#connection.headers;
	}

	get pairing() {
		return new PairingClient(this.origin, this.headers);
	}

	/**
	 * @param {{pairing?: object, runtime?: boolean}} [options] `runtime` copies the development runtime into the
	 * workspace, as a member named `runtime`
	 */
	async start({ pairing = { origins: [] }, runtime: copied = true } = {}) {
		cpSync(this.#fixture, this.#root, { recursive: true });
		if (copied) {
			const { root, entries } = runtime();
			mkdirSync(join(this.#root, 'runtime'));
			entries.forEach(entry => cpSync(join(root, entry), join(this.#root, 'runtime', entry), { recursive: true }));
		}
		process.env.BEE_HTTP_TIMEOUT ??= '180000';
		const service = new Service(new Context({ directory: this.#root, workspace: this.#root }), { home: this.#home });
		const { connection, token } = await service.acquire({ lifetime: 'owner', extensions: [DEVELOPMENT], ...(pairing ? { pairing } : {}) });
		this.#connection = connection;
		this.#attachment = await connection.attach('owner', { token });
		return this;
	}

	/**
	 * A request answered as {status, headers, body}, the body parsed when it is JSON; bounded, so a request that hangs
	 * fails the case. `listener: 'preview'` sends it to the preview listener of a service that pairs.
	 */
	send(method, path, { headers = this.headers, body, listener = 'api' } = {}) {
		const port = Number(new URL(listener === 'api' ? this.origin : this.session.service.preview).port);
		return new Promise((resolve, reject) => {
			const sent = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers }, timeout: 120000 }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => (text += chunk));
				response.on('end', () => {
					let parsed = text;
					try {
						parsed = text ? JSON.parse(text) : void 0;
					} catch {
						// Not JSON: kept as text
					}
					resolve({ status: response.statusCode, headers: response.headers, body: parsed });
				});
			});
			sent.on('timeout', () => sent.destroy(new Error(`${method} ${path}: no answer within 120 s`)));
			sent.on('error', reject);
			sent.end(typeof body === 'string' || body === undefined ? body : JSON.stringify(body));
		});
	}

	/**
	 * Opens the event stream and collects its events; `until(match)` waits for one within a bound, from the events
	 * received after `mark()` was called when it was
	 */
	stream(path = '/events', { headers = this.headers } = {}) {
		const port = Number(new URL(this.origin).port);
		return new Promise((resolve, reject) => {
			const events = [];
			const waiting = new Set();
			let from = 0;
			const sent = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => {
					text += chunk;
					for (const [, type, data] of text.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)) events.push({ type, data: JSON.parse(data), at: Date.now() });
					text = text.slice(text.lastIndexOf('\n\n') + 2);
					waiting.forEach(check => check());
				});
				const until = (match, ms = 60000) =>
					new Promise((done, failed) => {
						const test = typeof match === 'string' ? event => event.type === match : match;
						const timer = setTimeout(() => (waiting.delete(check), failed(new Error(`No matching event within ${ms} ms: ${JSON.stringify(events.slice(from).map(({ type }) => type))}`))), ms);
						const check = () => {
							const found = events.slice(from).find(test);
							if (!found) return;
							clearTimeout(timer);
							waiting.delete(check);
							done(found);
						};
						waiting.add(check);
						check();
					});
				const mark = () => (from = events.length);
				resolve({ status: response.statusCode, events, until, mark, since: () => events.slice(from), close: () => sent.destroy() });
			});
			sent.on('error', reject);
			sent.end();
		});
	}

	/**
	 * Ends the service by detaching its owner, waits within a bound for its discovery record to be removed, and
	 * removes the copy and the home
	 */
	async stop() {
		this.#attachment?.detach();
		const services = join(this.#home, 'services');
		const deadline = Date.now() + 60000;
		const recorded = () => existsSync(services) && readdirSync(services).some(name => name.endsWith('.json'));
		while (recorded() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
		const ended = !recorded();
		rmSync(this.#parent, { recursive: true, force: true });
		if (!ended) throw new Error('The service did not end within 60 s of its owner detaching');
	}
}
