import { connect } from 'node:net';

/**
 * Whether something listens on a port of this machine, as a target that listens there would find it: a connection to
 * the loopback addresses (`127.0.0.1`, then `::1`) is tried within a bound, and closed at once. Nothing is sent.
 *
 * A target's port is the `PORT` of the environment it is given (its variables in the settings, or the service's own), or
 * the port its declaration names.
 *
 * ```js
 * const ports = new Ports();
 * await ports.listener(5231);   // {port: 5231, address: '127.0.0.1'}, or undefined when nothing answers
 * Ports.of({ PORT: '5231' });   // 5231
 * ```
 */
export class Ports {
	static ADDRESSES = Object.freeze(['127.0.0.1', '::1']);

	/**
	 * Milliseconds a connection is given
	 */
	static BOUND = 500;

	#bound;

	/**
	 * @param {{bound?: number}} [options]
	 */
	constructor({ bound = Ports.BOUND } = {}) {
		this.#bound = bound;
	}

	/**
	 * A port a value names, undefined for anything that is not one
	 *
	 * @param {unknown} value
	 */
	static valid(value) {
		const port = typeof value === 'string' && /^\d{1,5}$/.test(value.trim()) ? Number(value) : value;
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : void 0;
	}

	/**
	 * The port of a target: `PORT` of its environment, else the one its declaration names
	 *
	 * @param {Record<string, string | undefined> | undefined} environment
	 * @param {{port?: unknown}} [declared]
	 */
	static of(environment, declared) {
		return Ports.valid(environment?.PORT) ?? Ports.valid(declared?.port);
	}

	/**
	 * What listens on a port of this machine, undefined when nothing accepted a connection within the bound
	 *
	 * @param {number} port
	 * @returns {Promise<{port: number, address: string} | undefined>}
	 */
	async listener(port) {
		const answers = await Promise.all(Ports.ADDRESSES.map(address => this.#try(address, port)));
		const address = Ports.ADDRESSES.find((one, index) => answers[index]);
		return address ? { port, address } : void 0;
	}

	#try(host, port) {
		return new Promise(resolve => {
			const socket = connect({ host, port });
			const done = accepted => {
				clearTimeout(timer);
				socket.destroy();
				resolve(accepted);
			};
			const timer = setTimeout(() => done(false), this.#bound);
			socket.once('connect', () => done(true));
			socket.once('error', () => done(false));
		});
	}
}
