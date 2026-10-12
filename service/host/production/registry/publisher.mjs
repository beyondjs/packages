import { spawn as spawned } from 'node:child_process';
import { Deadline } from '../../../deadline.mjs';

/**
 * Publishes a package archive with the host's own npm and its own configuration, never with a credential from a
 * browser: `npm publish <archive> --registry <url> --access <access> --tag <tag> --ignore-scripts`, run from the root of
 * the workspace (so its `.npmrc` applies as it does to npm there), with the environment of the service, no input (npm
 * cannot ask anything) and in a process group of its own.
 *
 * It waits `BEYOND_PUBLISH_TIMEOUT` milliseconds (120 s) at most; past it the group gets `SIGTERM`, and `SIGKILL` five
 * seconds later. What npm writes is kept in memory only, its last lines, with anything that looks like a credential
 * replaced (`Redaction`): an `_authToken`, `_auth` or `_password` setting, an `Authorization` scheme and its value,
 * and npm's token format. The answer says how npm ended and the code it reported (`E403`, `EOTP`, `ENEEDAUTH`, …),
 * never whether the registry holds the version: that is read from the registry afterwards.
 *
 * ```js
 * const { exit, code, output, expired } = await new Publisher({ cwd: root }).run({ file, registry, access, tag });
 * ```
 */
export class Publisher {
	static TIMEOUT = 120000;
	static GRACE = 5000;
	static LINES = 40;
	static #deadline = new Deadline('BEYOND_PUBLISH_TIMEOUT', Publisher.TIMEOUT);

	#cwd;
	#environment;
	#command;
	#spawn;
	#timeout;

	/**
	 * @param {{cwd: string, environment?: Record<string, string | undefined>, command?: string, args?: string[],
	 * spawn?: typeof spawned}} options Where npm runs, its environment, and the executable (`npm`, or a stand-in a test
	 * gives with the arguments that precede npm's own)
	 */
	constructor({ cwd, environment = process.env, command = process.platform === 'win32' ? 'npm.cmd' : 'npm', args = [], spawn = spawned }) {
		this.#cwd = cwd;
		this.#environment = environment;
		this.#command = [command, ...args];
		this.#spawn = spawn;
		this.#timeout = Publisher.#deadline.read(environment);
	}

	get timeout() {
		return this.#timeout;
	}

	/**
	 * Text without credentials
	 *
	 * @param {string} text
	 */
	static redact(text) {
		return String(text)
			.replace(/((?:_authToken|_auth|_password|password|token)\s*[=:]\s*)\S+/gi, '$1[redacted]')
			.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 [redacted]')
			.replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, '[redacted]');
	}

	/**
	 * npm's error code in its output (`npm error code E403`, `npm ERR! code EOTP`)
	 */
	static #code(lines) {
		for (const line of lines) {
			const found = /npm (?:error|ERR!) code (\S+)/.exec(line);
			if (found) return found[1];
		}
	}

	/**
	 * @param {{file: string, registry: string, access: string, tag: string}} request
	 * @returns {Promise<{exit: number | null, signal?: string, expired: boolean, code?: string, output: string[]}>}
	 */
	run({ file, registry, access, tag }) {
		const [command, ...prefix] = this.#command;
		const args = [...prefix, 'publish', file, '--registry', `${registry.replace(/\/+$/, '')}/`, '--access', access, '--tag', tag, '--ignore-scripts'];
		return new Promise(resolve => {
			const lines = [];
			const keep = chunk => {
				lines.push(...Publisher.redact(chunk).split(/\r?\n/).filter(Boolean));
				lines.splice(0, Math.max(0, lines.length - Publisher.LINES));
			};
			let child;
			try {
				child = this.#spawn(command, args, { cwd: this.#cwd, env: { ...this.#environment }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
			} catch (error) {
				return resolve({ exit: null, expired: false, code: 'ENOENT', output: [Publisher.redact(error.message)] });
			}
			let expired = false;
			const kill = signal => {
				try {
					process.kill(-child.pid, signal);
				} catch {
					// The group already ended
				}
			};
			const timer = setTimeout(() => {
				expired = true;
				kill('SIGTERM');
				setTimeout(() => kill('SIGKILL'), Publisher.GRACE).unref();
			}, this.#timeout);
			child.stdout.setEncoding('utf8').on('data', keep);
			child.stderr.setEncoding('utf8').on('data', keep);
			child.once('error', error => {
				clearTimeout(timer);
				resolve({ exit: null, expired, code: error.code ?? 'SPAWN_FAILED', output: [...lines, Publisher.redact(error.message)] });
			});
			child.once('close', (exit, signal) => {
				clearTimeout(timer);
				const code = Publisher.#code(lines);
				resolve({ exit, ...(signal ? { signal } : {}), expired, ...(code ? { code } : {}), output: lines });
			});
		});
	}
}
