/**
 * The driver's side of a consumer that runs `environment-consumer.mjs` in Node.js or in Deno: the process,
 * and the requests it answers over its standard streams.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeout } from '../stage-1/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, 'environment-consumer.mjs');

/**
 * One consumer process. The requests are lines of JSON on its stdin; the answers are the lines of its
 * stdout that start with `@@`. Everything else it prints is kept as its log.
 */
export class Channel {
	#name;
	get name() {
		return this.#name;
	}

	#process;
	#pending = new Map();
	#id = 0;
	#log = [];

	get log() {
		return this.#log.join('');
	}

	constructor(name) {
		this.#name = name;
	}

	/**
	 * @param command The executable and its arguments, before the script
	 * @param env What the consumer reads: `SERVICE_ORIGIN` and `CONSUMER_EVENTS`, and the loader's variables
	 */
	async start([executable, ...args], env, cwd) {
		this.#process = spawn(executable, [...args, SCRIPT], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
		this.#process.stderr.setEncoding('utf8').on('data', chunk => this.#log.push(chunk));

		const ready = new Promise((resolve, reject) => {
			this.#pending.set('ready', { resolve, reject });
			this.#process.once('exit', code => {
				const error = new Error(`${this.#name} exited with code ${code}:\n${this.log.slice(-2000)}`);
				this.#pending.forEach(({ reject }) => reject(error));
				this.#pending.clear();
			});
		});

		let text = '';
		this.#process.stdout.setEncoding('utf8').on('data', chunk => {
			for (text += chunk; text.includes('\n'); text = text.slice(text.indexOf('\n') + 1)) {
				const line = text.slice(0, text.indexOf('\n'));
				if (!line.startsWith('@@')) {
					this.#log.push(`${line}\n`);
					continue;
				}
				const message = JSON.parse(line.slice(2));
				const key = message.ready ? 'ready' : message.id;
				const pending = this.#pending.get(key);
				if (!pending) continue;
				this.#pending.delete(key);
				message.error ? pending.reject(new Error(`${this.#name}: ${message.error}`)) : pending.resolve(message.result);
			}
		});

		await Promise.race([ready, timeout(30000, `${this.#name} ready`)]);
		return this;
	}

	call(action, params, ms = 60000) {
		const id = ++this.#id;
		const promise = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
		this.#process.stdin.write(`${JSON.stringify({ id, action, params })}\n`);
		return Promise.race([promise, timeout(ms, `${this.#name} ${action}`)]);
	}

	async stop() {
		if (!this.#process || this.#process.exitCode !== null || this.#process.signalCode) return;
		const exited = new Promise(resolve => this.#process.once('exit', resolve));
		this.call('exit').catch(() => void 0);
		await Promise.race([exited, timeout(5000, `${this.#name} exit`)]).catch(() => this.#process.kill('SIGKILL'));
	}
}

/**
 * The Deno executable named by `BEYOND_DENO`, and the directory of its module cache, which each run owns so
 * that nothing a previous run downloaded is reused
 */
export class Deno {
	#executable;
	get executable() {
		return this.#executable;
	}

	#directory;

	get available() {
		return !!this.#executable;
	}

	constructor() {
		const { BEYOND_DENO } = process.env;
		this.#executable = BEYOND_DENO && existsSync(resolve(BEYOND_DENO)) ? resolve(BEYOND_DENO) : void 0;
	}

	/**
	 * The command that runs the consumer with an import map, which is either the address of the one the
	 * origin publishes or a file written here from its session
	 */
	async command(importmap) {
		this.#directory ??= await mkdtemp(join(tmpdir(), 'beyond-deno-'));
		let map = importmap;
		if (typeof importmap !== 'string') await writeFile((map = join(this.#directory, 'importmap.json')), JSON.stringify(importmap, null, '\t'));
		return [this.#executable, 'run', '--no-config', '--no-lock', '--allow-net', '--allow-import', '--allow-env', `--import-map=${map}`];
	}

	get env() {
		return { DENO_DIR: join(this.#directory, 'cache'), NO_COLOR: '1' };
	}

	destroy() {
		return this.#directory && rm(this.#directory, { recursive: true, force: true });
	}
}
