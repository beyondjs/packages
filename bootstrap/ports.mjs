import { createServer } from 'node:net';

/**
 * Local ports that are free when asked for. The bootstrap servers take their port from a manifest, so the
 * port has to be chosen before they start; asking the system for it avoids assuming any fixed port is free.
 *
 * A machine whose packet filter admits only known loopback ports (a Conduict machine runs the service as
 * its agent, which may reach only declared ranges) names a range in `BEYOND_BOOTSTRAP_PORTS`, as
 * `<first>-<last>`; the first free port of that range not handed out before by this process is taken, and
 * a range with none left is an error rather than a port outside it.
 */
export class Ports {
	/** Ports of the range already handed out by this process: nothing listens on them until Engine starts */
	static #given = new Set();

	/**
	 * @param {NodeJS.ProcessEnv} [env]
	 * @returns {Promise<number>}
	 */
	static async free(env = process.env) {
		const range = Ports.range(env.BEYOND_BOOTSTRAP_PORTS);
		if (!range) return Ports.#listen(0);
		for (let port = range.first; port <= range.last; port++) {
			if (Ports.#given.has(port)) continue;
			const taken = await Ports.#listen(port).then(() => false, () => true);
			if (taken) continue;
			Ports.#given.add(port);
			return port;
		}
		throw new Error(`No free port in BEYOND_BOOTSTRAP_PORTS (${range.first}-${range.last})`);
	}

	/** Gives a port back once its server stopped, so a later start in the same process may take it again */
	static release(port) {
		Ports.#given.delete(port);
	}

	/**
	 * @param {string | undefined} value `<first>-<last>`
	 * @returns {{first: number, last: number} | undefined}
	 */
	static range(value) {
		if (!value) return undefined;
		const match = /^(\d{1,5})-(\d{1,5})$/.exec(value.trim());
		const [first, last] = match ? [Number(match[1]), Number(match[2])] : [];
		if (!match || first < 1 || last > 65535 || first > last) throw new Error(`BEYOND_BOOTSTRAP_PORTS must be <first>-<last>, not "${value}"`);
		return { first, last };
	}

	static #listen(port) {
		return new Promise((resolve, reject) => {
			const server = createServer();
			server.unref();
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => {
				const { port: taken } = server.address();
				server.close(() => resolve(taken));
			});
		});
	}
}
