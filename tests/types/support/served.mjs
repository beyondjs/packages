import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Service } from '@beyond-js/packages/service';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const DEVELOPMENT = '@beyond-js/packages/development';

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
 * The real development service of a copy of the type browsing fixture, started from this checkout as the command line
 * starts it: through `@beyond-js/packages/service`, with the development extension and pairing, held by this process
 * as its owner, which is a local tool (its connection presents the local credential).
 *
 * The copy is the one change of layout: `workspace/` with the development runtime as its `runtime` member,
 * `installed/` as its `node_modules`, `nested/conditioned/` as `node_modules/conditioned/node_modules`, the
 * declaration of `linked` replaced by a symbolic link to a file outside that package, and `huge`, a package whose
 * declaration is generated past the size the route reads (see `fixtures/README.md`).
 *
 * ```js
 * const served = await new Served().start({ environment: { BEYOND_PREVIEW_CDN_TIMEOUT: '4000' } });
 * await served.send('GET', '/types?specifier=typed-lib');
 * await served.stop();
 * ```
 */
export class Served {
	/**
	 * The size of the generated declaration of `huge`: past the 1 MiB the route reads
	 */
	static HUGE = 1024 * 1024 + 4096;

	#parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond types ')));
	#root = join(this.#parent, 'workspace');
	#home = join(this.#parent, 'home');
	#connection;
	#attachment;

	get root() {
		return this.#root;
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

	#copy() {
		cpSync(join(FIXTURES, 'workspace'), this.#root, { recursive: true });
		const { root, entries } = runtime();
		mkdirSync(join(this.#root, 'runtime'));
		entries.forEach(entry => cpSync(join(root, entry), join(this.#root, 'runtime', entry), { recursive: true }));

		const installed = join(this.#root, 'node_modules');
		cpSync(join(FIXTURES, 'installed'), installed, { recursive: true });
		cpSync(join(FIXTURES, 'nested', 'conditioned'), join(installed, 'conditioned', 'node_modules'), { recursive: true });

		const linked = join(installed, 'linked', 'index.d.ts');
		unlinkSync(linked);
		symlinkSync(join(this.#root, 'beyond.json'), linked);

		const huge = join(installed, 'huge');
		mkdirSync(huge);
		writeFileSync(join(huge, 'package.json'), JSON.stringify({ name: 'huge', version: '1.0.0', types: './index.d.ts' }));
		const line = 'export declare const value: string;\n';
		writeFileSync(join(huge, 'index.d.ts'), `/** Generated past the bound */\n${line.repeat(Math.ceil(Served.HUGE / line.length))}`);
	}

	/**
	 * @param {{environment?: Record<string, string>, launch?: boolean}} [options] Variables of the environment the service
	 * starts with, and whether it launches execution targets: it is then given the `launch` setting with the stand-in
	 * registration and launcher of `tests/launches/fixtures/stand-ins`, which nothing here runs
	 */
	async start({ environment = {}, launch = false } = {}) {
		this.#copy();
		process.env.BEE_HTTP_TIMEOUT ??= '180000';
		const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
		Object.assign(process.env, environment);
		try {
			const service = new Service(new Context({ directory: this.#root, workspace: this.#root }), { home: this.#home });
			const launches = launch ? { launch: { node: { register: fileURLToPath(new URL('../../launches/fixtures/stand-ins/register.mjs', import.meta.url)), launcher: fileURLToPath(new URL('../../launches/fixtures/stand-ins/launcher.mjs', import.meta.url)) } } } : {};
			const { connection, token } = await service.acquire({ lifetime: 'owner', extensions: [DEVELOPMENT], pairing: { origins: [] }, ...launches });
			this.#connection = connection;
			this.#attachment = await connection.attach('owner', { token });
		} finally {
			Object.entries(previous).forEach(([key, value]) => (value === void 0 ? delete process.env[key] : (process.env[key] = value)));
		}
		return this;
	}

	/**
	 * A request with exactly the headers given (`Host` defaults to the loopback one of the listener), answered as
	 * {status, headers, body}, the body parsed when it is JSON; bounded, so a request that hangs fails the case
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {{headers?: object, body?: string, listener?: string}} [options] `listener` is an origin, the API's by default
	 */
	send(method, path, { headers = {}, body, listener = this.origin } = {}) {
		const port = Number(new URL(listener).port);
		return new Promise((resolve, reject) => {
			const sent = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers }, timeout: 180000 }, response => {
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
			sent.on('timeout', () => sent.destroy(new Error(`${method} ${path}: no answer within 180 s`)));
			sent.on('error', reject);
			sent.end(body);
		});
	}

	/**
	 * Opens the event stream as a local tool and collects its events; `until(type)` waits for one within a bound and
	 * `close()` ends the stream
	 */
	events() {
		const port = Number(new URL(this.origin).port);
		return new Promise((resolve, reject) => {
			const events = [];
			const waiting = new Set();
			const sent = request({ host: '127.0.0.1', port, path: '/events', headers: { host: `127.0.0.1:${port}`, ...this.headers } }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => {
					text += chunk;
					for (const [, type, data] of text.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)) events.push({ type, data: JSON.parse(data) });
					text = text.slice(text.lastIndexOf('\n\n') + 2);
					waiting.forEach(check => check());
				});
				const until = (match, ms = 30000) =>
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
				resolve({ status: response.statusCode, events, until, close: () => sent.destroy() });
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
