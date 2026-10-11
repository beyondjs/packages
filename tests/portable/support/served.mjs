import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, PairingClient, Service } from '@beyond-js/packages/service';

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url));
export const DEVELOPMENT = '@beyond-js/packages/development';

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
 * The real development service of a copy of the portable fixture, started from this checkout as the command line
 * starts it: through `@beyond-js/packages/service`, whose supervisor prepares Packages with the bootstrap Engine and
 * starts the host, here with the development extension and, unless a case says otherwise, pairing. This process holds
 * it as its owner and is a local tool: its connection presents the local credential.
 *
 * Its first start compiles Packages with Engine, which on a loaded machine takes minutes: `BEE_HTTP_TIMEOUT` is
 * raised to 180 s for the loader of the host unless it is set, and the start is bounded by `BEYOND_START_TIMEOUT`.
 *
 * ```js
 * const served = await new Served().start({ pairing: { origins: ['https://ui.example'] } });
 * await served.send('GET', '/files/tree', { headers: { origin: 'https://evil.example' } });
 * await served.stop();
 * ```
 */
export class Served {
	#parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond portable ')));
	#root = join(this.#parent, 'workspace');
	#home = join(this.#parent, 'home');
	#connection;
	#attachment;

	get root() {
		return this.#root;
	}

	/**
	 * The origin of the API listener
	 */
	get origin() {
		return this.#connection.origin;
	}

	/**
	 * The origin of the preview listener, or undefined for a service that does not pair
	 */
	get preview() {
		return this.session.service.preview;
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

	/**
	 * The pairing routes, as the command line uses them
	 */
	get pairing() {
		return new PairingClient(this.origin, this.headers);
	}

	/**
	 * @param {{pairing?: object, extensions?: string[]}} [options]
	 */
	async start({ pairing = { origins: [] }, extensions = [DEVELOPMENT] } = {}) {
		cpSync(FIXTURE, this.#root, { recursive: true });
		const { root, entries } = runtime();
		mkdirSync(join(this.#root, 'runtime'));
		entries.forEach(entry => cpSync(join(root, entry), join(this.#root, 'runtime', entry), { recursive: true }));
		writeFileSync(join(this.#root, 'app', '.env'), 'PORTABLE_SECRET=not a real secret\n');
		process.env.BEE_HTTP_TIMEOUT ??= '180000';
		const service = new Service(new Context({ directory: this.#root, workspace: this.#root }), { home: this.#home });
		const { connection, token } = await service.acquire({ lifetime: 'owner', extensions, ...(pairing ? { pairing } : {}) });
		this.#connection = connection;
		this.#attachment = await connection.attach('owner', { token });
		return this;
	}

	/**
	 * The port of a listener
	 */
	port(listener = 'api') {
		return Number(new URL(listener === 'api' ? this.origin : this.preview).port);
	}

	/**
	 * A request with exactly the headers given (`Host` defaults to the loopback one of the listener), answered as
	 * {status, headers, body}, the body parsed when it is JSON; bounded, so a request that hangs fails the case
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {{headers?: object, body?: string, listener?: 'api' | 'preview'}} [options]
	 */
	send(method, path, { headers = {}, body, listener = 'api' } = {}) {
		const port = this.port(listener);
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
			sent.end(body);
		});
	}

	/**
	 * Opens an event stream and collects its events; `until(type)` waits for one within a bound
	 */
	stream(path, { headers = {}, listener = 'api' } = {}) {
		const port = this.port(listener);
		return new Promise((resolve, reject) => {
			const events = [];
			const waiting = new Set();
			const sent = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => {
					text += chunk;
					for (const [, type, data] of text.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)) events.push({ type, data: JSON.parse(data) });
					text = text.slice(text.lastIndexOf('\n\n') + 2);
					waiting.forEach(check => check());
				});
				response.on('end', () => waiting.forEach(check => check()));
				const until = (match, ms = 60000) =>
					new Promise((done, failed) => {
						const test = typeof match === 'string' ? event => event.type === match : match;
						const timer = setTimeout(() => (waiting.delete(check), failed(new Error(`No matching event within ${ms} ms: ${JSON.stringify(events.map(({ type }) => type))}`))), ms);
						const check = () => {
							const found = events.find(test);
							if (!found) return;
							clearTimeout(timer);
							waiting.delete(check);
							done(found);
						};
						waiting.add(check);
						check();
					});
				resolve({ status: response.statusCode, headers: response.headers, events, until, close: () => sent.destroy() });
			});
			sent.on('error', reject);
			sent.end();
		});
	}

	/**
	 * Ends the service by detaching its owner, waits within a bound for its discovery record to be removed, which its
	 * supervisor does last, and removes the copy and the home
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
