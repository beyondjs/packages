import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Operations } from '../../../service/host/operations/operations.mjs';
import { Services } from '../../../service/host/features.mjs';
import { Modules } from '../../../service/host/dependencies/modules.mjs';
import { Feature } from '../../../service/host/dependencies/index.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const revision = bytes => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * Stands in for the File API of the development extension over a directory: `read` answers the bytes and their
 * revision, `mutate` writes only when the file still has the expected revision. `before(path)`, when given, runs
 * between a read and the write that follows it, as an editor that saves meanwhile.
 */
export class FilesStand {
	#root;
	#before;
	writes = [];

	constructor(root, { before } = {}) {
		this.#root = root;
		this.#before = before;
	}

	async read(path) {
		const bytes = await readFile(join(this.#root, path));
		return { bytes, revision: revision(bytes), cursor: '0' };
	}

	async mutate({ operation, path, expected }, actor, bytes) {
		await this.#before?.(path);
		const current = revision(await readFile(join(this.#root, path)));
		if (operation !== 'write' || current !== expected) return { outcome: 'conflict', path, conflict: { expected, current } };
		await writeFile(join(this.#root, path), bytes);
		this.writes.push({ path, actor });
		return { outcome: 'completed', path, revision: revision(bytes) };
	}
}

/**
 * Stands in for the `Installation` of Packages: `resolve`, `releases` and `install` answer what a case scripts, and every
 * call is recorded with its parameters and options. `releases` reads `catalog[name]` (a missing name is not found) and,
 * after `hold()`, waits until `release()`, rejecting when its signal is aborted, as the real requests are.
 */
export class InstallationStand {
	calls = [];
	resolutions = [];
	catalog = {};
	report;
	gate;
	#open;

	hold() {
		this.gate = new Promise(resolve => (this.#open = resolve));
	}

	release() {
		this.#open?.();
		this.gate = void 0;
	}

	get class() {
		const stand = this;
		return class Installation {
			#params;
			constructor(params) {
				this.#params = params;
			}
			async resolve(options) {
				stand.calls.push({ method: 'resolve', params: this.#params, options });
				const next = stand.resolutions.length > 1 ? stand.resolutions.shift() : stand.resolutions[0];
				return typeof next === 'function' ? next(this.#params, options) : next;
			}
			async releases(names, { signal, progress } = {}) {
				stand.calls.push({ method: 'releases', params: this.#params, names });
				const answered = [];
				for (const name of names) {
					if (stand.gate) await Promise.race([stand.gate, new Promise((resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))]);
					const found = stand.catalog[name];
					answered.push(found ? { name, checked: '2026-10-11T12:00:00.000Z', ...found } : { name, found: false, access: 'unknown', versions: [], tags: {}, deprecated: {}, checked: '2026-10-11T12:00:00.000Z', error: { code: 'PACKAGE_NOT_FOUND', message: `There is no package "${name}"` } });
					progress?.({ name, done: answered.length, total: names.length });
				}
				return answered;
			}
			async install(options) {
				stand.calls.push({ method: 'install', params: this.#params, options });
				['resolution', 'download', 'materialization'].forEach(phase => options.progress?.({ phase, ...(phase === 'download' ? { total: 2 } : {}) }));
				return stand.report;
			}
		};
	}
}

/**
 * A copy of a fixture workspace with dependency management mounted on an ephemeral loopback port, as the host mounts
 * it, over stand-ins: the File API (`FilesStand`, or none), the `Installation` (`InstallationStand`), `Execution` (a
 * projection in the state the case gives), and the served workspace (reloads counted, `published()` given). The
 * operations are the host's own, on the copy. Everything is removed with the case.
 */
export class Stage {
	root;
	origin;
	feature;
	operations;
	files;
	installation = new InstallationStand();
	reloads = 0;
	#server;
	#directory;

	/**
	 * @param {import('node:test').TestContext} t
	 * @param {{fixture?: string, lock?: boolean, files?: boolean, before?: Function, state?: string, supplied?: string[],
	 * libraries?: string[], published?: object[] | (() => Promise<object[]>), applications?: {catalog(): unknown}}}
	 * [options] `libraries` are supplied fixtures given as libraries of the toolchain's installation (`library: true`);
	 * `published` is what the served workspace publishes, or what answers it; `applications` the catalog the extension
	 * would share
	 */
	static async start(t, options = {}) {
		const stage = new Stage();
		t.after(() => stage.stop());
		await stage.#start(options);
		return stage;
	}

	async #start({ fixture = 'workspace', lock = false, files = true, before, state = 'missing', supplied = [], libraries = [], published = [], applications }) {
		this.#directory = realpathSync(mkdtempSync(join(tmpdir(), 'beyond-dependencies-')));
		this.root = join(this.#directory, 'workspace');
		cpSync(join(FIXTURES, fixture), this.root, { recursive: true });
		lock && cpSync(join(FIXTURES, 'locks', 'workspace.json'), join(this.root, 'beyond-lock.json'));
		const copies = [...supplied, ...libraries].map(name => {
			const path = join(this.#directory, 'supplied', name);
			cpSync(join(FIXTURES, 'supplied', name), path, { recursive: true });
			const library = libraries.includes(name) ? { library: true } : {};
			return { name: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).name, path, ...library };
		});

		const services = new Services();
		this.files = files ? new FilesStand(this.root, { before }) : void 0;
		this.files && services.set('files', this.files);
		applications && services.set('applications', applications);
		this.operations = new Operations({ root: this.root });
		await this.operations.start();
		const Execution = { read: async () => ({ state, diagnostics: [], ...(state === 'ready' ? { execution: { node: () => ({}) } } : {}) }) };
		const workspace = { reload: async () => void this.reloads++, published: async () => (typeof published === 'function' ? published() : published) };
		const context = { root: this.root, settings: { supplied: copies }, workspace, operations: this.operations, services, log: () => void 0, environment: {} };
		this.feature = new Feature(context, new Modules({ Installation: this.installation.class, Execution }));
		await this.feature.start();

		const app = express();
		this.feature.setup(app);
		this.#server = app.listen(0, '127.0.0.1');
		await new Promise(resolve => this.#server.once('listening', resolve));
		this.origin = `http://127.0.0.1:${this.#server.address().port}`;
	}

	/**
	 * A request answered as `{status, body}`; a JSON body is sent as JSON unless `type` says otherwise
	 */
	async send(method, path, { body, headers = {}, type = 'application/json' } = {}) {
		const sent = body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': type, ...headers } };
		const response = await fetch(`${this.origin}${path}`, { method, headers, ...sent, signal: AbortSignal.timeout(10000) });
		const text = await response.text();
		const json = (response.headers.get('content-type') ?? '').includes('application/json');
		return { status: response.status, headers: response.headers, body: json ? JSON.parse(text) : text || void 0 };
	}

	/**
	 * Starts an operation and waits, within a bound, until it is no longer running
	 */
	async run(path, body, headers) {
		const started = await this.send('POST', path, { body, headers });
		if (started.status !== 202 && started.status !== 200) throw new Error(`POST ${path} answered ${started.status}: ${JSON.stringify(started.body)}`);
		return await this.ended(started.body.operation.id);
	}

	async ended(id, until = record => record.state !== 'running') {
		const bound = Date.now() + 10000;
		for (;;) {
			const record = await this.operations.get(id);
			if (until(record)) return record;
			if (Date.now() > bound) throw new Error(`The operation ${id} did not end within 10 s: ${JSON.stringify(record)}`);
			await new Promise(resolve => setTimeout(resolve, 5));
		}
	}

	read(path) {
		return readFileSync(join(this.root, path), 'utf8');
	}

	write(path, text) {
		writeFileSync(join(this.root, path), text);
	}

	async stop() {
		this.installation.release();
		this.#server?.closeAllConnections?.();
		await new Promise(resolve => (this.#server ? this.#server.close(resolve) : resolve()));
		await this.operations?.idle().catch(() => void 0);
		this.#directory && rmSync(this.#directory, { recursive: true, force: true });
	}
}
