import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Service } from '@beyond-js/packages/service';

export const DEVELOPMENT = '@beyond-js/packages/development';

/**
 * The sources of the development runtime, `BEYOND_RUNTIME` or the suite's `local-2026` beside this repository: its
 * manifest and the directory of each module it exports, which is what a copy of the package needs
 */
const runtime = () => {
	const sibling = ['../../../../../local-2026', '../../../../local-2026'].map(path => fileURLToPath(new URL(path, import.meta.url))).find(path => existsSync(path));
	const root = resolve(process.env.BEYOND_RUNTIME || sibling || '');
	if (!existsSync(join(root, 'bundle/index.ts'))) throw new Error(`The development runtime was not found in ${root}. Set BEYOND_RUNTIME.`);
	const { exports } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const entries = ['package.json', ...new Set(Object.values(exports).map(target => String(target).replace(/^\.\//, '').split('/')[0]))];
	return { root, entries: entries.filter(entry => existsSync(join(root, entry))) };
};

/**
 * The real development service of a copy of a fixture, started from this checkout as the command line starts it
 * (`@beyond-js/packages/service`, whose supervisor prepares Packages with the bootstrap Engine and starts the host),
 * with the development extension and without pairing, as `beyond build` starts its own. This process holds it as its
 * owner. A copy of the `web` fixture receives what the fixture cannot hold: the development runtime as the member
 * `runtime`, the installed package `tiny` in `node_modules`, and a `.env` beside the page's sources, which no export may
 * contain. The `packages` fixture is copied as it is, with the files a case gives (`files`).
 *
 * ```js
 * const served = await new Served(parent).start();
 * await served.send('POST', '/production/exports', { headers, body });
 * await served.stop();
 * ```
 */
export class Served {
	#root;
	#home;
	#fixture;
	#connection;
	#attachment;

	/**
	 * @param {string} parent A temporary directory of the case, which the copy and the home of the service go into
	 * @param {{fixture?: 'web' | 'packages'}} [options]
	 */
	constructor(parent, { fixture = 'web' } = {}) {
		this.#root = join(parent, 'workspace');
		this.#home = join(parent, 'home');
		this.#fixture = fixture;
	}

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
	 * @param {{environment?: Record<string, string>, files?: Record<string, string>}} [options] Variables the service
	 * is started with (`BEYOND_CDN_ORIGIN`, npm's configuration), and files written into the copy
	 */
	async start({ environment = {}, files = {} } = {}) {
		cpSync(fileURLToPath(new URL(`../fixtures/${this.#fixture}`, import.meta.url)), this.#root, { recursive: true });
		this.#fixture === 'web' && this.#web();
		Object.entries(files).forEach(([path, content]) => writeFileSync(join(this.#root, path), content));

		process.env.BEE_HTTP_TIMEOUT ??= '180000';
		const previous = Object.fromEntries(Object.keys(environment).map(name => [name, process.env[name]]));
		Object.assign(process.env, environment);
		try {
			const service = new Service(new Context({ directory: this.#root, workspace: this.#root }), { home: this.#home });
			const { connection, token } = await service.acquire({ lifetime: 'owner', extensions: [DEVELOPMENT] });
			this.#connection = connection;
			this.#attachment = await connection.attach('owner', { token });
		} finally {
			Object.entries(previous).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
		}
		return this;
	}

	/**
	 * What the web fixture's copy receives
	 */
	#web() {
		const { root, entries } = runtime();
		mkdirSync(join(this.#root, 'runtime'));
		entries.forEach(entry => cpSync(join(root, entry), join(this.#root, 'runtime', entry), { recursive: true }));
		mkdirSync(join(this.#root, 'node_modules'));
		cpSync(join(this.#root, 'vendor', 'tiny'), join(this.#root, 'node_modules', 'tiny'), { recursive: true });
		rmSync(join(this.#root, 'vendor'), { recursive: true });
		writeFileSync(join(this.#root, 'web', '.env'), 'PRODUCTION_SECRET=not-a-real-secret\n');
	}

	/**
	 * A JSON request, bounded, answered as `{status, headers, body}`
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {{headers?: object, body?: object}} [options]
	 */
	async send(method, path, { headers = {}, body } = {}) {
		const response = await fetch(`${this.origin}${path}`, {
			method,
			headers: { ...this.#connection.headers, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
			body: body ? JSON.stringify(body) : void 0,
			signal: AbortSignal.timeout(300000)
		});
		const text = await response.text();
		let parsed = text;
		try {
			parsed = text ? JSON.parse(text) : void 0;
		} catch {
			// Not JSON: kept as text
		}
		return { status: response.status, headers: Object.fromEntries(response.headers), body: parsed };
	}

	/**
	 * Follows an operation until it ends, within a bound
	 *
	 * @param {string} location
	 */
	async follow(location, bound = 600000) {
		const deadline = Date.now() + bound;
		for (;;) {
			const { body } = await this.send('GET', location);
			if (body.operation.state !== 'running') return body.operation;
			if (Date.now() > deadline) throw new Error(`The operation ${location} did not end within ${bound} ms`);
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}

	/**
	 * Ends the service by detaching its owner and waits, within a bound, for its discovery record to be removed
	 */
	async stop() {
		this.#attachment?.detach();
		const services = join(this.#home, 'services');
		const deadline = Date.now() + 60000;
		const recorded = () => existsSync(services) && readdirSync(services).some(name => name.endsWith('.json'));
		while (recorded() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
		if (recorded()) throw new Error('The service did not end within 60 s of its owner detaching');
	}
}
