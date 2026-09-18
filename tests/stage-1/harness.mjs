/**
 * The infrastructure the stage-1 checks are written against: how a step is run and reported, how a variant
 * of the fixture is built, and how the process that executes the artifacts is driven.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The fixture compiled by this validation, and where its artifacts are written
 */
export const testbed = resolve(here, '../../../testbed');
export const artifactsPath = join(testbed, '.artifacts');
export const conditions = { platform: 'node' };

/**
 * The outcome of every step that ran, in order
 */
export const results = [];

/**
 * Runs one step and reports it. A failure does not interrupt the run, so one execution reports the state of
 * every checked behavior instead of only the first defect.
 *
 * @param name What the step establishes
 * @param fn The checks, which may return a short note describing what was observed
 */
export const step = async (name, fn) => {
	const started = Date.now();
	try {
		const notes = await fn();
		results.push({ name, ok: true, ms: Date.now() - started, notes });
		console.log(`PASS ${name}${notes ? ` — ${notes}` : ''}`);
	} catch (error) {
		results.push({ name, ok: false, ms: Date.now() - started, error });
		console.log(`FAIL ${name}\n${error.stack}`);
	}
};

/**
 * Resolves the next time a dynamic processor reports a change, and stops listening
 */
export const once = (dp, event) =>
	new Promise(resolve =>
		dp.on(event, function listener(...args) {
			dp.off(event, listener);
			resolve(args);
		})
	);

/**
 * Rejects after a delay, so a check that waits for something that never happens fails with what it waited for
 */
export const timeout = (ms, what) =>
	new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: timeout after ${ms} ms`)), ms));

/**
 * Rewrites a JSON file of a fixture copy through a mutation of its parsed content
 */
export const json = async (file, mutate) => {
	const value = JSON.parse(await readFile(file, 'utf8'));
	mutate(value);
	await writeFile(file, JSON.stringify(value, null, '\t'));
};

/**
 * Builds a temporary copy of the fixture with a mutation applied, to check what a package developer obtains
 * from a configuration or a source that the main fixture does not have
 *
 * @returns The build report of the mutated workspace
 */
export async function variant(name, mutate) {
	const root = await mkdtemp(join(tmpdir(), `beyond-stage1-${name}-`));
	await cp(testbed, root, { recursive: true, filter: source => !source.includes('/.artifacts') });
	await mutate(root);

	const workspace = new Workspace(root);
	const artifacts = new Artifacts(workspace, { path: join(root, '.artifacts'), conditions });
	const report = await artifacts.build();

	workspace.destroy();
	await rm(root, { recursive: true, force: true });
	return report;
}

/**
 * The process that executes the artifacts.
 *
 * It is an ordinary Node process: it has no development server and no knowledge of Packages, it only
 * resolves the public specifiers through the import map that the build wrote. Keeping it alive across the
 * whole run is what makes the update checks meaningful, because an update is only observable in a process
 * that already loaded the module it updates.
 */
export class Consumer {
	#process;
	#pending = new Map();
	#id = 0;

	async start(importmap) {
		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect'));
		this.#process = spawn(process.execPath, [...execArgv, join(here, 'consumer.mjs')], {
			// The runtime is an installed package, resolved from here
			cwd: process.cwd(),
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
	}

	/**
	 * Asks the consumer to load the artifacts, apply an update or exit, and returns what it observed
	 */
	call(action, params) {
		const id = ++this.#id;
		const promise = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
		this.#process.send({ id, action, params });
		return Promise.race([promise, timeout(15000, `consumer ${action}`)]);
	}

	/**
	 * @returns The exit code of the process, to check that it ended on its own
	 */
	async stop() {
		if (!this.#process || this.#process.exitCode !== null) return this.#process?.exitCode;

		const exited = new Promise(resolve => this.#process.once('exit', resolve));
		await this.call('exit').catch(() => this.#process.kill());
		return await Promise.race([exited, timeout(5000, 'consumer exit')]);
	}
}
