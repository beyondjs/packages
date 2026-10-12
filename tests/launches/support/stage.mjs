import { chmodSync, copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Services } from '../../../service/host/features.mjs';
import { Feature } from '../../../service/host/launches/index.mjs';

const STAND_INS = fileURLToPath(new URL('../fixtures/stand-ins/', import.meta.url));

/**
 * What the catalog of applications answers for a target of the stand-in application `fixture`: a backend whose entry
 * names a behavior of the stand-in launcher, its runtime and its readiness text
 *
 * @param {string} behavior
 * @param {{runtime?: string, readiness?: string | null}} [options]
 */
export const backend = (behavior, { runtime = 'node', readiness = 'stand-in listening' } = {}) => ({
	declared: { kind: 'backend', runtime, ...(readiness ? { readiness: { output: readiness } } : {}) },
	entry: { specifier: `stand-in/${behavior}` },
	environment: /^(node|deno)/.exec(runtime)?.[1],
	launch: { supported: true }
});

/**
 * The launches feature as its unit tests drive it: mounted on an Express application of its own, with stand-ins for
 * what the host gives it (the catalog of applications, the settings feature, the event bus, the origin) and the
 * stand-in registration and launcher of `fixtures/stand-ins`, so every process it starts is one of their behaviors.
 * Everything it creates is removed after the case, on failure as well.
 *
 * ```js
 * const stage = await new Stage({ targets: { server: backend('server') } }).start(t);
 * const { status, body } = await stage.request('POST', '/launches', { body: { application: 'fixture', target: 'server' }, key: 'request-0001' });
 * await stage.until(body.launch.id, launch => launch.state === 'ready');
 * ```
 */
export class Stage {
	#targets;
	#settings;
	#environment;
	#launch;
	#root = realpathSync(mkdtempSync(join(tmpdir(), 'beyond launches ')));
	#events = [];
	#middleware;
	#catalog;
	#host;
	#origins;
	#feature;
	#server;
	#origin;

	/**
	 * @param {{targets?: Record<string, object>, catalog?: object | null, settings?: object, environment?: object,
	 * launch?: object | null, host?: object, middleware?: (app: object) => void, origins?: boolean}} [options] The
	 * targets of the application `fixture` the catalog resolves (or a catalog of its own, null for none), the values of
	 * the settings feature, variables of the service, the `launch` setting (the stand-ins by default, null for a service
	 * without it), other settings of the host over the default `pairing` (a service that launches pairs browsers or
	 * verifies delegated grants; `pairing: undefined` stands for one that does neither), what is mounted before the
	 * routes (the decision of a policy, for example), and whether the host gives the feature its origins (false for one
	 * that gives none)
	 */
	constructor({ targets = {}, catalog, settings, environment = {}, launch, host = {}, middleware, origins = true } = {}) {
		this.#targets = targets;
		this.#settings = settings;
		this.#environment = environment;
		const stand = { node: { register: join(STAND_INS, 'register.mjs'), launcher: join(STAND_INS, 'launcher.mjs') } };
		this.#launch = launch === undefined ? stand : launch;
		this.#catalog = catalog === undefined ? { resolve: (application, target) => this.#resolve(application, target) } : catalog;
		this.#host = host;
		this.#middleware = middleware;
		this.#origins = origins;
	}

	get root() {
		return this.#root;
	}

	get origin() {
		return this.#origin;
	}

	get feature() {
		return this.#feature;
	}

	/**
	 * The events the feature announced, as `{type, ...data}`
	 */
	get events() {
		return this.#events;
	}

	/**
	 * A copy of the stand-in Deno executable in a directory of its own, made executable, removed after the case
	 *
	 * @param {import('node:test').TestContext} t
	 * @returns {string} Its path
	 */
	static deno(t) {
		const directory = mkdtempSync(join(tmpdir(), 'beyond launches deno '));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const executable = join(directory, 'deno');
		copyFileSync(join(STAND_INS, 'deno.mjs'), executable);
		chmodSync(executable, 0o755);
		return executable;
	}

	#resolve(application, target) {
		const error = (code, message) => Object.assign(new Error(message), { code });
		if (application !== 'fixture') return Promise.reject(error('APPLICATION_NOT_FOUND', `No application "${application}"`));
		const resolved = this.#targets[target];
		if (!resolved) return Promise.reject(error('TARGET_NOT_FOUND', `No target "${target}"`));
		return typeof resolved === 'function' ? resolved() : Promise.resolve(structuredClone(resolved));
	}

	/**
	 * Starts the feature and its application; what it started ends after the case
	 *
	 * @param {import('node:test').TestContext} t
	 */
	async start(t) {
		const services = new Services();
		this.#catalog && services.set('applications', this.#catalog);
		const values = this.#settings;
		values && services.set('settings', { value: key => values[key] });
		const settings = { root: this.#root, pairing: { origins: [] }, ...this.#host, ...(this.#launch ? { launch: this.#launch } : {}) };
		const events = { emit: (type, data) => this.#events.push({ type, ...structuredClone(data) }) };
		const environment = { ...process.env, ...this.#environment };
		const origins = { api: () => (this.#origins ? this.#origin : void 0) };
		this.#feature = new Feature({ root: this.#root, settings, events, services, origins, environment, log: () => void 0 });
		t.after(() => this.stop());
		await this.#feature.start();

		const app = express();
		this.#middleware?.(app);
		this.#feature.setup(app);
		this.#server = app.listen(0, '127.0.0.1');
		await new Promise(resolve => this.#server.once('listening', resolve));
		this.#origin = `http://127.0.0.1:${this.#server.address().port}`;
		return this;
	}

	/**
	 * A request answered as `{status, headers, body}`, the body parsed when it is JSON; bounded, so one that hangs
	 * fails the case
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {{body?: object | string, key?: string, headers?: object}} [options]
	 */
	async request(method, path, { body, key, headers = {} } = {}) {
		const json = body !== undefined && typeof body !== 'string';
		const sent = {
			method,
			headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}), ...headers },
			body: json ? JSON.stringify(body) : body,
			signal: AbortSignal.timeout(10000)
		};
		const response = await fetch(`${this.#origin}${path}`, sent);
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
	 * Launches a target of `fixture`
	 *
	 * @param {string} target
	 * @param {string} key
	 */
	launch(target, key) {
		return this.request('POST', '/launches', { body: { application: 'fixture', target }, key });
	}

	/**
	 * Waits until a launch holds a condition, failing past a bound instead of hanging
	 *
	 * @param {string} id
	 * @param {(launch: object) => boolean} condition
	 * @param {number} [bound] Milliseconds
	 */
	async until(id, condition, bound = 10000) {
		const started = Date.now();
		for (;;) {
			const { body } = await this.request('GET', `/launches/${id}`);
			if (condition(body.launch)) return body.launch;
			if (Date.now() - started > bound) throw new Error(`The launch did not reach the expected condition within ${bound}ms: ${JSON.stringify(body)}`);
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	}

	/**
	 * The text of the output of a launch
	 *
	 * @param {string} id
	 */
	async output(id) {
		const { body } = await this.request('GET', `/launches/${id}/output`);
		return body.lines.map(line => line.text);
	}

	/**
	 * Ends the feature as the service's end does, closes the application and removes the root
	 */
	async stop() {
		await this.#feature?.stop();
		this.#server?.closeAllConnections?.();
		await new Promise(resolve => (this.#server ? this.#server.close(() => resolve()) : resolve()));
		this.#server = undefined;
		this.#feature = undefined;
		rmSync(this.#root, { recursive: true, force: true });
	}
}

/**
 * Whether a process is gone
 *
 * @param {number} pid
 */
export const gone = pid => {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return error.code === 'ESRCH';
	}
};
