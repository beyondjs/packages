import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Connection } from '../../connection.mjs';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Fails a wait that does not end
 */
const bounded = (promise, ms, what) => {
	let timer;
	const expired = new Promise((resolve, reject) => (timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms)));
	return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
};

/**
 * The real host of a development service (`service/host/main.mjs`), started from this checkout as its supervisor
 * starts it: in a process group of its own, reporting its start on fd 3, with the settings a supervisor gives it,
 * and attached by the calling process as its owner. `stop()` detaches, which ends it, and then ends its group,
 * where the watchers service and the monitor it forks are. The calling process must run under BEE Node, whose
 * loader the host inherits, with `BEE_URL` and `WATCHERS_URL` naming the servers of Packages and of the watchers
 * utility.
 *
 * ```js
 * const host = await new Host().start({ root, supplied, extensions, runtime, env });
 * await fetch(`${host.origin}/state`);
 * await host.stop();
 * ```
 */
export class Host {
	#process;
	#attachment;
	#log = [];
	#origin;

	get origin() {
		return this.#origin;
	}

	/**
	 * What the host wrote on its standard output and error
	 */
	get log() {
		return this.#log.join('');
	}

	/**
	 * @param {{root: string, supplied?: object[], extensions?: string[], runtime?: string[], env?: object}} options
	 * The workspace, the packages the toolchain supplies, the extensions, the runtime packages a Node consumer
	 * resolves from the installation, and the variables the host is given besides the loader's
	 */
	async start({ root, supplied = [], extensions = [], runtime = [], env = {} }) {
		const { BEE_URL, WATCHERS_URL } = process.env;
		if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the servers of Packages and of the watchers utility.');

		const token = randomUUID();
		const settings = {
			root, standalone: false, lifetime: 'owner', token, toolchain: 'checkout', versions: {}, supplied, extensions,
			runtime: { packages: runtime, base: pathToFileURL(join(PACKAGES, 'package.json')).href },
			watchers: { env: { BEE_URL: WATCHERS_URL }, cwd: PACKAGES }
		};

		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect') && !arg.startsWith('--test'));
		this.#process = spawn(process.execPath, [...execArgv, join(PACKAGES, 'service/host/main.mjs')], {
			cwd: PACKAGES,
			detached: true,
			stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
			env: { ...process.env, BEE_URL, BEE_ADAPTER: '', BEE_IMPORT_MAP: '', ...env, BEYOND_HOST_OPTIONS: JSON.stringify(settings) }
		});
		[1, 2].forEach(fd => this.#process.stdio[fd].setEncoding('utf8').on('data', chunk => this.#log.push(chunk)));

		const reported = new Promise((resolve, reject) => {
			let text = '';
			this.#process.stdio[3].setEncoding('utf8').on('data', chunk => {
				if (!(text += chunk).includes('\n')) return;
				const message = JSON.parse(text.slice(0, text.indexOf('\n')));
				message.ready ? resolve(message.ready.origin) : reject(new Error(`The host failed to start: ${message.failed}\n${this.log}`));
			});
			this.#process.once('exit', code => reject(new Error(`The host ended with code ${code}:\n${this.log}`)));
		});
		this.#origin = await bounded(reported, 180000, 'the host to be ready');
		this.#attachment = await new Connection(this.#origin).attach('owner', { token });
		return this;
	}

	async stop() {
		if (!this.#process) return;
		const exited = this.#process.exitCode === null ? new Promise(resolve => this.#process.once('exit', resolve)) : Promise.resolve();
		this.#attachment?.detach();
		await bounded(exited, 15000, 'the host to end').catch(() => this.#process.kill('SIGKILL'));
		try {
			// The watchers service and the monitor it forks are in the group of the host this process started
			process.kill(-this.#process.pid, 'SIGKILL');
		} catch {
			// The group already ended
		}
	}
}
