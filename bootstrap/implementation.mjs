import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Group } from './group.mjs';
import { Ports } from './ports.mjs';

const ENTRY = fileURLToPath(new URL('./engine.cjs', import.meta.url));

/**
 * One Beyond-authored implementation project (Packages, the watchers service) compiled and served as ESM by
 * its own Engine process. Engine compiles the implementation and nothing of the target workspace, which it
 * never sees.
 *
 * Engine reads the port from the manifest of the project and writes its cache next to it. The installed
 * project is therefore not used in place: it is staged in a directory of the service, with the sources
 * linked, the manifest reduced to one ESM distribution on a port that is free now, and `node_modules`
 * linked to where the installed dependencies of the project are. Two services never share a port, and an
 * installation can be read-only.
 */
export class Implementation {
	#name;
	#component;
	#engine;
	#directory;
	#log;

	#group;
	#port;

	/**
	 * The origin that serves the compiled implementation, once started
	 */
	get url() {
		return `http://127.0.0.1:${this.#port}`;
	}

	/**
	 * The process group of the bootstrap server, which its forked workers belong to whatever they call
	 * themselves
	 */
	get group() {
		return this.#group?.pid;
	}

	/**
	 * The staged project, which is also where the installed dependencies of the implementation resolve from
	 */
	get directory() {
		return this.#directory;
	}

	/**
	 * @param {{name: string, component: {path: string, modules: string}, engine: {path: string},
	 * directory: string, log: string}} options
	 */
	constructor({ name, component, engine, directory, log }) {
		this.#name = name;
		this.#component = component;
		this.#engine = engine;
		this.#directory = directory;
		this.#log = log;
	}

	#stage() {
		rmSync(this.#directory, { recursive: true, force: true });
		mkdirSync(this.#directory, { recursive: true });

		const skipped = ['package.json', 'node_modules', '.beyond', '.git'];
		for (const entry of readdirSync(this.#component.path)) {
			if (!skipped.includes(entry)) symlinkSync(join(this.#component.path, entry), join(this.#directory, entry));
		}
		symlinkSync(this.#component.modules, join(this.#directory, 'node_modules'));

		const manifest = JSON.parse(readFileSync(join(this.#component.path, 'package.json'), 'utf8'));

		// Engine refuses to serve a project whose declared packages are not installed, and an installation
		// never has the development dependencies of the implementation, which serving it does not use.
		// Optional peers, such as this bootstrap itself, are not installed dependencies of the project either.
		delete manifest.devDependencies;
		delete manifest.peerDependencies;
		delete manifest.peerDependenciesMeta;

		manifest.deployment = {
			distributions: [
				{
					name: 'node-esm',
					platform: 'node',
					bundles: { mode: 'esm' },
					development: { tools: false },
					ports: { bundles: this.#port }
				}
			]
		};
		writeFileSync(join(this.#directory, 'package.json'), JSON.stringify(manifest, null, '\t'));
		return manifest.name;
	}

	/**
	 * Starts Engine on the staged project and waits until it serves the expected package
	 *
	 * @param {number} [timeout]
	 */
	async start(timeout = 90000) {
		this.#port = await Ports.free();
		const specifier = this.#stage();

		const output = openSync(this.#log, 'a');
		const child = spawn(process.execPath, [ENTRY, this.#engine.path], {
			cwd: this.#directory,
			detached: true,
			stdio: ['ignore', output, output],
			env: { ...process.env, BEE_URL: '', BEE_ADAPTER: '', BEE_IMPORT_MAP: '', NODE_OPTIONS: '' }
		});
		this.#group = new Group(child);

		let failure;
		child.once('error', error => (failure = error.message));
		child.once('exit', (code, signal) => (failure = `exited (${signal ?? code})`));

		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			if (failure) throw new Error(`The ${this.#name} bootstrap ${failure}. See ${this.#log}`);

			try {
				const response = await fetch(`${this.url}/project.json`, { signal: AbortSignal.timeout(2000) });
				if (response.ok && (await response.json()).specifier === specifier) return;
			} catch {
				// Not listening yet
			}
			await sleep(250);
		}

		await this.stop();
		throw new Error(`The ${this.#name} bootstrap did not become ready in ${timeout} ms. See ${this.#log}`);
	}

	async stop() {
		await this.#group?.stop();
		this.#group = undefined;
	}
}
