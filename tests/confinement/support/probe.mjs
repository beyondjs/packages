/**
 * What the confinement validation observes of code a package supplies and of files outside the packages.
 *
 * The fixture code that a confined compilation must never run (a Tailwind plugin and configuration, a bundler
 * and a processor written as `data:` URLs) does two things when it runs: it writes a marker file whose name
 * starts with `BEYOND_CONFINEMENT_MARKER`, and it opens a connection to `BEYOND_CONFINEMENT_PORT`, a server
 * this probe listens with on an allocated loopback port. The files outside the packages carry one value,
 * `Probe.SECRET`, which must never appear in what a confined compilation returns.
 */
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class Probe {
	static SECRET = 'CONFINEMENT_SECRET_7d1f';

	/**
	 * Whether a value of the files outside the packages appears in a result: its outputs, bytes included, and
	 * its diagnostics
	 */
	static leaked(result) {
		const text = JSON.stringify(result, (key, value) => (value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value));
		return text.includes(Probe.SECRET);
	}

	#marker;
	#server;
	#connections = 0;
	#waiting = new Set();

	/**
	 * How many connections the code a package supplies opened
	 */
	get connections() {
		return this.#connections;
	}

	/**
	 * @param root The temporary directory of the run, where the markers are written
	 */
	constructor(root) {
		this.#marker = join(root, 'marker');
	}

	/**
	 * Whether the code of a kind (`plugin`, `config`, `bundler`, `processor`) ran
	 */
	executed(kind) {
		return existsSync(`${this.#marker}.${kind}`);
	}

	async start() {
		this.#server = createServer(socket => {
			this.#connections++;
			socket.destroy();
			this.#waiting.forEach(resolve => resolve());
		});
		await new Promise((resolve, reject) => this.#server.once('error', reject).listen(0, '127.0.0.1', resolve));
		process.env.BEYOND_CONFINEMENT_MARKER = this.#marker;
		process.env.BEYOND_CONFINEMENT_PORT = String(this.#server.address().port);
		return this;
	}

	/**
	 * Resolves once a connection arrives, or rejects when none arrives within the bound
	 */
	connection(bound = 10_000) {
		if (this.#connections) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => (this.#waiting.delete(done), reject(new Error(`No connection within ${bound} ms`))), bound);
			const done = () => (clearTimeout(timer), this.#waiting.delete(done), resolve());
			this.#waiting.add(done);
		});
	}

	async close() {
		delete process.env.BEYOND_CONFINEMENT_MARKER;
		delete process.env.BEYOND_CONFINEMENT_PORT;
		await new Promise(resolve => (this.#server ? this.#server.close(() => resolve()) : resolve()));
	}
}
