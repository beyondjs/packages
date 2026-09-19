/**
 * The infrastructure of the esbuild packaging trial: where the fork's compiler is, how a copy of the suite
 * testbed is given a mode per module, and the process that executes the artifacts.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, cp, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The fixture is the one the stage-1 validation resolves, including its BEYOND_TESTBED override
export { step, results, once, timeout, testbed } from '../stage-1/harness.mjs';
import { timeout, testbed } from '../stage-1/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The compiler package the fork lays out with `node beyond/package.mjs`. It is selected by location so the
 * trial installs nothing into Packages and cannot pick up the esbuild that Packages depends on.
 */
export class Fork {
	#root;

	constructor() {
		const { BEYOND_ESBUILD } = process.env;
		if (!BEYOND_ESBUILD) throw new Error('Set BEYOND_ESBUILD to the Beyond ESBuild checkout.');
		this.#root = resolve(BEYOND_ESBUILD);
		if (!existsSync(this.file)) throw new Error(`Run "node beyond/package.mjs" in ${this.#root} first.`);
	}

	get file() {
		return join(this.#root, 'beyond/.cache/npm/node_modules/esbuild/lib/main.js');
	}

	get specifier() {
		return pathToFileURL(this.file).href;
	}

	async version() {
		return (await readFile(join(this.#root, 'version.txt'), 'utf8')).trim();
	}
}

const json = async (file, mutate) => {
	const value = JSON.parse(await readFile(file, 'utf8'));
	mutate(value);
	await writeFile(file, JSON.stringify(value, null, '\t'));
};

/**
 * A temporary copy of the testbed in which each public module selects its mode through its manifest, which
 * is how any bundler is selected. The suite fixture itself is never edited.
 */
export class Fixture {
	#root;
	get root() {
		return this.#root;
	}

	/**
	 * @param modes The bundler of each module: `{ shared: 'esbuild' | 'ts', app: 'esbuild' | 'ts' }`
	 * @param compiler The compiler setting of the esbuild bundler, a function that computes it from the root
	 * of the copy (its two packages sit at the same depth), or undefined to leave it unselected
	 */
	async create(modes, compiler) {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-esbuild-trial-')));
		await cp(testbed, this.#root, { recursive: true, filter: source => !source.includes('/.artifacts') });

		const selected = typeof compiler === 'function' ? compiler(this.#root) : compiler;
		const processors = selected ? { bundle: { compiler: selected } } : {};
		for (const [location, module] of [['shared', 'message'], ['app', 'main']]) {
			await json(join(this.#root, location, 'package.json'), manifest => {
				manifest.bundlers.esbuild = { specifier: '@beyond-js/packages/bundlers/esbuild', processors };
			});
			await json(join(this.#root, location, module, 'module.json'), manifest => (manifest.bundler = modes[location]));
		}
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
 * The process that executes the artifacts, resolved through the import map of a build. `cwd` decides where
 * installed packages resolve from: the Packages directory has the legacy Kernel, an empty directory has
 * nothing, which is how a packaged workspace shows that it needs no runtime.
 */
export class Consumer {
	#process;
	#pending = new Map();
	#id = 0;

	async start(importmap, cwd) {
		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect'));
		this.#process = spawn(process.execPath, [...execArgv, join(here, 'consumer.mjs')], {
			cwd,
			env: Object.assign({}, process.env, { BEE_URL: '', BEE_IMPORT_MAP: importmap }),
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
