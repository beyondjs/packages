import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Service } from '@beyond-js/packages/service';

const FIXTURE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url));
export const DEVELOPMENT = '@beyond-js/packages/development';

/**
 * A checkout of the suite beside this repository, in its current layout (`packages/core`) or the earlier one
 */
const sibling = name => ['../../../../../', '../../../../'].map(prefix => fileURLToPath(new URL(`${prefix}${name}`, import.meta.url))).find(path => existsSync(path));

/**
 * What a launch needs from the toolchain, as an installation of the command line provides it: the BEE Node registration
 * (`BEE_NODE_DIR`, or the suite's `bee-node`), the command line's launcher (`BEYOND_CLI_DIR`, or the suite's `cli`) and
 * the development runtime the fixture is assembled against (`BEYOND_RUNTIME`, or the suite's `local-2026`)
 */
export class Toolchain {
	static get register() {
		return Toolchain.#file('BEE_NODE_DIR', 'bee-node', 'register.mjs');
	}

	static get launcher() {
		return Toolchain.#file('BEYOND_CLI_DIR', 'cli', 'src/launcher.mjs');
	}

	static get runtime() {
		const root = resolve(process.env.BEYOND_RUNTIME || sibling('local-2026') || 'local-2026');
		if (!existsSync(join(root, 'bundle/index.ts'))) throw new Error(`The development runtime was not found in ${root}. Set BEYOND_RUNTIME.`);
		const { exports } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const entries = ['package.json', ...new Set(Object.values(exports).map(target => String(target).replace(/^\.\//, '').split('/')[0]))];
		return { root, entries: entries.filter(entry => existsSync(join(root, entry))) };
	}

	static #file(variable, checkout, file) {
		const path = join(resolve(process.env[variable] || sibling(checkout) || checkout), file);
		if (!existsSync(path)) throw new Error(`${file} was not found at ${path}. Set ${variable}.`);
		return path;
	}
}

/**
 * The real development service of a copy of the launch fixture, started from this checkout as the command line's
 * `beyond run` starts it: through `@beyond-js/packages/service`, with the development extension, pairing and, unless a
 * case says otherwise, the `launch` setting naming the registration and launcher of the suite's checkouts. This process
 * holds it as its owner and is a local tool: its requests present the local credential.
 *
 * Its first start compiles Packages with Engine, which on a loaded machine takes minutes: `BEE_HTTP_TIMEOUT` is raised to
 * 180 s for the loader of the host unless it is set, and the start is bounded by `BEYOND_START_TIMEOUT`.
 */
export class Served {
	#parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond launches served ')));
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
	 * @param {{launch?: boolean, deno?: string, prepare?: (root: string) => void}} [options] Whether the service launches
	 * targets, the Deno executable its `launch` setting names, and what a case changes in the copy before its first start
	 */
	async start({ launch = true, deno, prepare } = {}) {
		if (!existsSync(this.#root)) {
			cpSync(FIXTURE, this.#root, { recursive: true });
			const { root, entries } = Toolchain.runtime;
			mkdirSync(join(this.#root, 'runtime'));
			entries.forEach(entry => cpSync(join(root, entry), join(this.#root, 'runtime', entry), { recursive: true }));
			prepare?.(this.#root);
		}
		process.env.BEE_HTTP_TIMEOUT ??= '180000';

		const setting = launch ? { launch: { node: { register: Toolchain.register, launcher: Toolchain.launcher }, ...(deno ? { deno: { executable: deno } } : {}) } } : {};
		const service = new Service(new Context({ directory: this.#root, workspace: this.#root }), { home: this.#home });
		const { connection, token } = await service.acquire({ lifetime: 'owner', extensions: [DEVELOPMENT], pairing: { origins: [] }, ...setting });
		this.#connection = connection;
		this.#attachment = await connection.attach('owner', { token });
		return this;
	}

	/**
	 * A request of a local tool (the local credential), answered as `{status, headers, body}`, the body parsed when it is
	 * JSON; bounded, so a request that hangs fails the case
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {{body?: object, key?: string, headers?: object}} [options]
	 */
	async send(method, path, { body, key, headers = {} } = {}) {
		const sent = {
			method,
			headers: { ...this.#connection.headers, ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}), ...headers },
			body: body ? JSON.stringify(body) : void 0,
			signal: AbortSignal.timeout(180000)
		};
		const response = await fetch(`${this.origin}${path}`, sent);
		const text = await response.text();
		let parsed = text;
		try {
			parsed = text ? JSON.parse(text) : void 0;
		} catch {
			// Not JSON: kept as text
		}
		return { status: response.status, headers: response.headers, body: parsed };
	}

	/**
	 * Waits until a launch holds a condition, failing past a bound instead of hanging
	 */
	async until(id, condition, bound = 120000) {
		const started = Date.now();
		for (;;) {
			const { body } = await this.send('GET', `/launches/${id}`);
			if (condition(body.launch)) return body.launch;
			if (Date.now() - started > bound) {
				const output = await this.send('GET', `/launches/${id}/output`);
				throw new Error(`The launch did not reach the expected condition within ${bound}ms: ${JSON.stringify(body)}\n${output.body?.lines?.map(line => line.text).join('\n')}`);
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * The end of the log of the service, for a case that failed
	 */
	log(lines = 60) {
		const services = join(this.#home, 'services');
		return (existsSync(services) ? readdirSync(services) : [])
			.map(entry => join(services, entry, 'service.log'))
			.filter(file => existsSync(file))
			.map(file => readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n'))
			.join('\n');
	}

	/**
	 * Opens the event stream of the development extension and collects its events; `until(match)` waits for one
	 * within a bound
	 */
	async events() {
		const controller = new AbortController();
		const response = await fetch(`${this.origin}/events`, { headers: this.#connection.headers, signal: controller.signal });
		const events = [];
		const waiting = new Set();
		void (async () => {
			let text = '';
			try {
				for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
					text += chunk;
					for (const [, type, data] of text.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)) events.push({ type, data: JSON.parse(data) });
					text = text.slice(text.lastIndexOf('\n\n') + 2);
					waiting.forEach(check => check());
				}
			} catch {
				// Closed by the case
			}
		})();
		const until = (match, ms = 60000) =>
			new Promise((done, failed) => {
				const check = () => {
					const found = events.find(match);
					if (!found) return;
					clearTimeout(timer);
					waiting.delete(check);
					done(found);
				};
				const timer = setTimeout(() => (waiting.delete(check), failed(new Error(`No matching event within ${ms} ms: ${JSON.stringify(events.map(({ type }) => type))}`))), ms);
				waiting.add(check);
				check();
			});
		return { status: response.status, events, until, close: () => controller.abort() };
	}

	/**
	 * Ends the service by detaching its owner and waits within a bound for its discovery record to be removed, which
	 * its supervisor does last; the copy and the home are kept for a later start
	 */
	async end() {
		this.#attachment?.detach();
		this.#attachment = undefined;
		const services = join(this.#home, 'services');
		const deadline = Date.now() + 60000;
		const recorded = () => existsSync(services) && readdirSync(services).some(name => name.endsWith('.json'));
		while (recorded() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
		if (recorded()) throw new Error('The service did not end within 60 s of its owner detaching');
	}

	/**
	 * Ends the service and removes the copy and the home
	 */
	async stop() {
		try {
			await this.end();
		} finally {
			rmSync(this.#parent, { recursive: true, force: true });
		}
	}
}
