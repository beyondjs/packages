/**
 * The infrastructure of the unified-runtime validation: where the runtime package is, how the fixture and
 * the runtime become one temporary workspace, and the process that executes its artifacts.
 */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { timeout } from '../stage-1/harness.mjs';
import { Connection } from '../../service/connection.mjs';

export { step, results, once, timeout } from '../stage-1/harness.mjs';
export { Fork } from '../esbuild-packaging/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The checkout of the development runtime, `local-2026` beside this repository unless BEYOND_RUNTIME names it
 */
export class Runtime {
	static specifier = '@beyond-js/local-2026/bundle';

	#root = resolve(process.env.BEYOND_RUNTIME || resolve(here, '../../../local-2026'));
	get root() {
		return this.#root;
	}

	constructor() {
		if (!existsSync(join(this.#root, 'bundle/index.ts'))) throw new Error(`The development runtime was not found in ${this.#root}. Set BEYOND_RUNTIME.`);
	}

	/**
	 * What a copy of the runtime package needs: its manifest and the directory of each exported module
	 */
	static entries(root) {
		const { exports } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const directories = Object.values(exports).map(target => target.replace(/^\.\//, '').split('/')[0]);
		return ['package.json', ...new Set(directories)];
	}
}

/**
 * A temporary workspace with the fixture packages and the runtime package as its sources are, so Packages
 * compiles the three of them and the permanent files are never edited
 */
export class Fixture {
	#root;
	get root() {
		return this.#root;
	}

	async create(runtime) {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-unified-runtime-')));
		await cp(join(here, 'fixture'), this.#root, { recursive: true });

		const target = join(this.#root, 'runtime');
		await mkdir(target);
		// The manifest and the directory of every public module the runtime exports
		for (const entry of Runtime.entries(runtime.root)) {
			existsSync(join(runtime.root, entry)) && (await cp(join(runtime.root, entry), join(target, entry), { recursive: true }));
		}

		// The working directory of the consumer: an empty one, so nothing of the workspace is resolved by location
		await mkdir(join(this.#root, '.consumer'));
		return this;
	}

	file(...parts) {
		return join(this.#root, ...parts);
	}

	destroy() {
		return rm(this.#root, { recursive: true, force: true });
	}
}

/**
 * The process that executes the artifacts, resolved through the import map of a build
 */
export class Consumer {
	#script;
	#process;
	#pending = new Map();
	#id = 0;

	/**
	 * @param script The file of this directory that the process runs
	 */
	constructor(script = 'consumer.mjs') {
		this.#script = script;
	}

	/**
	 * @param env How the loader of the process resolves public modules: an import map or a development service
	 */
	async start(env, cwd) {
		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect'));
		this.#process = spawn(process.execPath, [...execArgv, join(here, this.#script)], {
			cwd,
			env: Object.assign({}, process.env, { BEE_URL: '', BEE_ADAPTER: '', BEE_IMPORT_MAP: '' }, env),
			stdio: ['ignore', 'inherit', 'inherit', 'ipc']
		});
		this.#process.on('message', message => {
			if (message.ready) return this.#pending.get('ready')?.resolve();
			const pending = this.#pending.get(message.id);
			if (!pending) return;
			this.#pending.delete(message.id);
			message.error ? pending.reject(new Error(`consumer: ${message.error}`)) : pending.resolve(message.result);
		});
		const ready = new Promise((resolve, reject) => {
			this.#pending.set('ready', { resolve, reject });
			this.#process.once('exit', code => reject(new Error(`consumer exited with code ${code}`)));
		});
		await Promise.race([ready, timeout(15000, 'consumer ready')]);
		return this;
	}

	call(action, params) {
		const id = ++this.#id;
		const promise = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
		this.#process.send({ id, action, params });
		return Promise.race([promise, timeout(15000, `consumer ${action}`)]);
	}

	async stop() {
		if (!this.#process || this.#process.exitCode !== null) return this.#process?.exitCode;
		const exited = new Promise(resolve => this.#process.once('exit', resolve));
		await this.call('exit').catch(() => this.#process.kill());
		return await Promise.race([exited, timeout(5000, 'consumer exit')]);
	}
}

/**
 * The development service of Packages, started as its supervisor starts it: the host of `service/host`, in
 * its bootstrap form, with the development extension that publishes change and build events. The driver
 * attaches as the owner, which is what keeps the service alive, and detaches to end it.
 */
export class Host {
	#process;
	#attachment;
	#log = [];

	#origin;
	get origin() {
		return this.#origin;
	}

	get log() {
		return this.#log.join('');
	}

	/**
	 * @param root The workspace to serve
	 * @param env What the host process needs besides the loader: where the implementation and the watchers
	 * utility are served, the port when the origin must survive a restart, the access context of the owner
	 * when the service is started in delegated mode, and the variables the manifests of the workspace name
	 */
	async start(root, { implementation, watchers, port = 0, headers = {}, ...env }) {
		const packages = resolve(here, '../..');
		const token = randomUUID();
		const settings = {
			root, standalone: false, port, token, lifetime: 'owner', toolchain: 'checkout', versions: {},
			runtime: { packages: [], base: pathToFileURL(join(packages, 'package.json')).href },
			watchers: { env: { BEE_URL: watchers }, cwd: packages },
			extensions: ['@beyond-js/packages/development']
		};

		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect'));
		this.#process = spawn(process.execPath, [...execArgv, join(packages, 'service/host/main.mjs')], {
			cwd: packages,
			stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
			env: { ...process.env, BEE_URL: implementation, BEE_ADAPTER: '', BEE_IMPORT_MAP: '', ...env, BEYOND_HOST_OPTIONS: JSON.stringify(settings) }
		});
		[1, 2].forEach(fd => this.#process.stdio[fd].setEncoding('utf8').on('data', chunk => this.#log.push(chunk)));

		const reported = new Promise((resolve, reject) => {
			let text = '';
			this.#process.stdio[3].setEncoding('utf8').on('data', chunk => {
				if (!(text += chunk).includes('\n')) return;
				const message = JSON.parse(text.slice(0, text.indexOf('\n')));
				message.ready ? resolve(message.ready.origin) : reject(new Error(`The service failed to start: ${message.failed}`));
			});
			this.#process.once('exit', code => reject(new Error(`The service ended with code ${code}:\n${this.log}`)));
		});
		this.#origin = await Promise.race([reported, timeout(90000, 'service ready')]);

		// The client of the service itself, which holds the attachment open and keeps reading it
		this.#attachment = await new Connection(this.#origin, void 0, headers).attach('owner', { token });
		return this;
	}

	async stop() {
		if (!this.#process || this.#process.exitCode !== null) return;
		const exited = new Promise(resolve => this.#process.once('exit', resolve));
		this.#attachment?.detach();
		this.#process.kill('SIGTERM');
		await Promise.race([exited, timeout(10000, 'service exit')]).catch(() => this.#process.kill('SIGKILL'));
	}
}
