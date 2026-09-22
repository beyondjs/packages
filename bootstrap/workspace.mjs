import { spawn } from 'node:child_process';
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Group } from './group.mjs';
import { Ports } from './ports.mjs';
import { Project } from './project.mjs';

const ENTRY = fileURLToPath(new URL('./engine.cjs', import.meta.url));

/**
 * The Engine development server of a bootstrap, over the projects it compiles and serves as ESM.
 *
 * Engine reads `beyond.json` of its working directory and serves every package registered there, each on the
 * port of its own manifest, from one process. That registration is what puts a local utility in front of the
 * copy the installation resolved from the registry: the package is compiled from its sources here and the
 * loader of the host is given its origin, so nothing has to be published to exercise a change in it.
 *
 * Engine never sees the workspace that the service serves, and nothing of this reaches a consumer of the
 * served modules.
 */
export class Workspace {
	#directory;
	#engine;
	#log;

	#group;
	get group() {
		return this.#group?.pid;
	}

	#projects = new Map();

	/**
	 * The staged projects by name, each with its origin, its specifier and its version
	 */
	get projects() {
		return this.#projects;
	}

	/**
	 * @param {{directory: string, engine: {path: string}, log: string}} options
	 */
	constructor({ directory, engine, log }) {
		this.#directory = directory;
		this.#engine = engine;
		this.#log = log;
	}

	/**
	 * Stages the projects, registers them in one `beyond.json` and starts the server over them
	 *
	 * @param {{name: string, component: object}[]} projects
	 * @param {number} [timeout] Milliseconds to wait until every project is served
	 */
	async start(projects, timeout = 90000) {
		rmSync(this.#directory, { recursive: true, force: true });
		mkdirSync(this.#directory, { recursive: true });

		const registered = [];
		for (const { name, component } of projects) {
			const project = new Project({
				name,
				component,
				directory: join(this.#directory, name),
				port: await Ports.free()
			});
			this.#projects.set(name, project);
			registered.push(project.stage());
		}

		// The package configuration of the compiler: the projects this server compiles and serves
		writeFileSync(join(this.#directory, 'beyond.json'), JSON.stringify({ packages: registered }, null, '\t'));

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

		try {
			await this.#await(() => failure, timeout);
		} catch (error) {
			await this.stop();
			throw error;
		}
	}

	/**
	 * Waits until every staged project answers with the package it is expected to publish
	 */
	async #await(failure, timeout) {
		const pending = new Set(this.#projects.values());
		const deadline = Date.now() + timeout;

		while (Date.now() < deadline) {
			const reason = failure();
			if (reason) throw new Error(`The bootstrap server ${reason}. See ${this.#log}`);

			for (const project of pending) {
				try {
					const response = await fetch(`${project.url}/project.json`, { signal: AbortSignal.timeout(2000) });
					if (response.ok && (await response.json()).specifier === project.specifier) pending.delete(project);
				} catch {
					// Not listening yet
				}
			}
			if (!pending.size) return;
			await sleep(250);
		}

		const names = [...pending].map(project => project.specifier).join(', ');
		throw new Error(`The bootstrap did not serve ${names} within ${timeout} ms. See ${this.#log}`);
	}

	async stop() {
		await this.#group?.stop();
		this.#group = undefined;
	}
}
