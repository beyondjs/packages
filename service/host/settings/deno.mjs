import { spawn } from 'node:child_process';

/**
 * Asks an executable whether it is Deno 2: runs `<path> --version` and reads the first line it prints
 * (`deno 2.1.4 (stable, release, …)`).
 *
 * The wait is bounded (`Deno.TIMEOUT`, 5 s): an executable that does not answer within it, or that leaves a process
 * holding its output open, is refused, and the process group it leads is ended, so a check never holds the request
 * that asked for it. The executable runs in a process group of its own and receives only `PATH`, `HOME` and
 * `NO_COLOR`: never the environment of the service, which holds its credentials.
 *
 * ```js
 * await new Deno().check('/opt/deno/bin/deno');   // {version: '2.1.4'} or {message: 'is Deno 1.46.3, and …'}
 * ```
 */
export class Deno {
	/**
	 * Milliseconds an executable is given to answer `--version`
	 */
	static TIMEOUT = 5000;

	static #VERSION = /^deno (\d+)\.(\d+)\.(\d+)/m;
	static #OUTPUT = 4096;

	#timeout;
	#environment;

	/**
	 * @param {{timeout?: number, environment?: Record<string, string | undefined>}} [options] The bound, and the
	 * environment whose `PATH` and `HOME` the executable receives
	 */
	constructor({ timeout = Deno.TIMEOUT, environment = process.env } = {}) {
		this.#timeout = timeout;
		this.#environment = environment;
	}

	get timeout() {
		return this.#timeout;
	}

	/**
	 * @param {string} path The absolute path of the executable
	 * @returns {Promise<{version: string} | {message: string}>} Its version, or why it is not a Deno 2 executable
	 */
	check(path) {
		const { PATH = '', HOME = '' } = this.#environment;
		return new Promise(resolve => {
			let output = '';
			let settled = false;
			let timer;
			const done = result => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(result);
			};

			let child;
			try {
				child = spawn(path, ['--version'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH, HOME, NO_COLOR: '1' } });
			} catch (error) {
				return done({ message: `could not be run (${error.code ?? error.message})` });
			}

			timer = setTimeout(() => {
				Deno.#end(child);
				child.stdout?.destroy();
				done({ message: `did not answer "--version" within ${this.#timeout} ms` });
			}, this.#timeout);

			child.on('error', error => done({ message: `could not be run (${error.code ?? error.message})` }));
			child.stdout.setEncoding('utf8').on('data', chunk => (output = (output + chunk).slice(0, Deno.#OUTPUT)));
			// Every stream of the process is closed: what it printed is complete
			child.on('close', () => done(Deno.#answer(output)));
		});
	}

	/**
	 * What an executable's answer to `--version` says
	 */
	static #answer(output) {
		const match = Deno.#VERSION.exec(output);
		if (!match) {
			const first = output.split('\n')[0].trim().slice(0, 120);
			return { message: first ? `answered "--version" with "${first}", which is not Deno's answer` : 'printed nothing for "--version"' };
		}
		const [, major, minor, patch] = match;
		if (major !== '2') return { message: `is Deno ${major}.${minor}.${patch}, and Deno 2 is required` };
		return { version: `${major}.${minor}.${patch}` };
	}

	/**
	 * Ends the process group the executable leads, which also ends what it started and left running
	 */
	static #end(child) {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			try {
				child.kill('SIGKILL');
			} catch {
				// Already ended
			}
		}
	}
}
