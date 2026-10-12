import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Host } from '../../../service/test/support/host.mjs';
import { Registry } from './registry.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const DEVELOPMENT = '@beyond-js/packages/development';

// Settings of the environment through which npm settings could send a request elsewhere than the fixture registries
const VARIABLES = /^NPM_(REGISTRY|TOKEN|AUTH|USERNAME|PASSWORD|SCOPE_.+|HOST_.+)$/;

/**
 * A copy of a fixture workspace served by the real host of the development service (`service/host/main.mjs`, started
 * by the service's own `support/host.mjs` with the development extension), with two in-process registries: a public
 * one, and the private one of the `@team` scope, behind a token, that refuses `@team/secret-sdk` to it as well. The
 * copy's `.npmrc` (written here, with the allocated ports) routes every name to them, the scopes this fixture uses
 * included, so no setting of the user reaches the network; the host's source store and metadata cache are directories
 * of the copy. Run under BEE Node with `BEE_URL` and `WATCHERS_URL`, as `tests/local-install/service.test.mjs`.
 *
 * ```js
 * const scenario = await new Scenario('workspace').start({ releases: ['react@18.3.1'] });
 * const { operation } = await scenario.run('/dependencies/preflight', {});
 * await scenario.stop();
 * ```
 */
export class Scenario {
	static TOKEN = 'team-token';

	#fixture;
	#directory;
	#root;
	#host = new Host();
	#public = new Registry();
	#team = new Registry({ token: Scenario.TOKEN, denied: ['@team/secret-sdk'] });

	/**
	 * @param {'workspace' | 'hello'} fixture The directory of `fixtures/` the copy is made of
	 */
	constructor(fixture) {
		this.#fixture = fixture;
	}

	get root() {
		return this.#root;
	}

	get origin() {
		return this.#host.origin;
	}

	/**
	 * What the host wrote, for a failure's message
	 */
	get log() {
		return this.#host.log;
	}

	/**
	 * The public registry and the private one
	 */
	get registries() {
		return { public: this.#public, team: this.#team };
	}

	/**
	 * @param {{releases: string[], supplied?: string[]}} options The releases published before the host starts
	 * (`name@version`), and the directories of `fixtures/supplied` given to the host as what the toolchain supplies
	 */
	async start({ releases, supplied = [] }) {
		this.#directory = realpathSync(mkdtempSync(join(tmpdir(), 'beyond dependencies ')));
		this.#root = join(this.#directory, 'workspace');
		cpSync(join(FIXTURES, this.#fixture), this.#root, { recursive: true });
		Object.keys(process.env).filter(key => VARIABLES.test(key)).forEach(key => delete process.env[key]);

		await this.#public.start();
		await this.#team.start();
		for (const release of releases) await this.publish(release);
		const [base, team] = [this.#public.url, this.#team.url];
		const npmrc = [`registry=${base}`, `@beyond-js:registry=${base}`, `@fixture:registry=${base}`, `@testbed:registry=${base}`, `@team:registry=${team}`, `${this.#team.key}:_authToken=${Scenario.TOKEN}`];
		writeFileSync(join(this.#root, '.npmrc'), `${npmrc.join('\n')}\n`);

		const copies = supplied.map(name => {
			const path = join(this.#directory, 'supplied', name);
			cpSync(join(FIXTURES, 'supplied', name), path, { recursive: true });
			const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
			return { name: manifest.name, path, dependencies: Object.keys(manifest.dependencies ?? {}) };
		});
		const env = { BEYOND_SOURCES_DIR: join(this.#directory, 'store'), BEYOND_METADATA_DIR: join(this.#directory, 'metadata') };
		await this.#host.start({ root: this.#root, supplied: copies, extensions: [DEVELOPMENT], env });
		return this;
	}

	/**
	 * Publishes a release of `fixtures/registry` to the registry of its scope
	 *
	 * @param {string} release `name@version`
	 */
	async publish(release) {
		const at = release.lastIndexOf('@');
		const [name, version] = [release.slice(0, at), release.slice(at + 1)];
		const registry = name.startsWith('@team/') ? this.#team : this.#public;
		await registry.publish(join(FIXTURES, 'registry', name, version));
	}

	/**
	 * A request to the service, answered as `{status, headers, body}` with a JSON body parsed; bounded, so a request
	 * that hangs fails the case
	 *
	 * @param {string} method
	 * @param {string} path
	 * @param {{body?: unknown, headers?: object, raw?: string}} [options] `body` is sent as JSON
	 */
	async request(method, path, { body, headers = {}, raw } = {}) {
		const json = body !== undefined ? { 'content-type': 'application/json' } : {};
		const response = await fetch(`${this.origin}${path}`, {
			method,
			headers: { ...json, ...headers },
			body: raw ?? (body !== undefined ? JSON.stringify(body) : void 0),
			signal: AbortSignal.timeout(120000)
		});
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
	 * An operation once it ended, read from the service until then, within a bound
	 *
	 * @param {string} id
	 * @param {(record: object) => boolean} [until] What to wait for; the end by default
	 */
	async operation(id, until = record => record.state !== 'running', bound = 180000) {
		const started = Date.now();
		for (;;) {
			const { status, body } = await this.request('GET', `/operations/${id}`);
			if (status !== 200) throw new Error(`GET /operations/${id} answered ${status}: ${JSON.stringify(body)}`);
			if (until(body.operation)) return body.operation;
			if (Date.now() - started > bound) throw new Error(`The operation ${id} did not reach the expected state within ${bound} ms: ${JSON.stringify(body.operation)}`);
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	}

	/**
	 * Starts an operation and answers its record once it ended, with the answer that started it
	 */
	async run(path, body, headers = {}) {
		const started = await this.request('POST', path, { body, headers });
		if (started.status !== 202 && started.status !== 200) throw new Error(`POST ${path} answered ${started.status}: ${JSON.stringify(started.body)}`);
		return { started, operation: await this.operation(started.body.operation.id) };
	}

	/**
	 * A file of the copy, as text
	 */
	read(path) {
		return readFileSync(join(this.#root, path), 'utf8');
	}

	/**
	 * The lock of the copy, parsed
	 */
	get lock() {
		return JSON.parse(this.read('beyond-lock.json'));
	}

	async stop() {
		await this.#host.stop();
		await this.#public.stop().catch(() => void 0);
		await this.#team.stop().catch(() => void 0);
		this.#directory && rmSync(this.#directory, { recursive: true, force: true });
	}
}
