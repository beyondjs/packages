import { lookup } from 'node:dns';

/**
 * The loopback names of a Snapshots destination: `127.0.0.1`, `[::1]`, and `localhost` with every name under it,
 * which RFC 6761 reserves for loopback (the suite's local composition names Snapshots
 * `http://snapshots.beyond.localhost:<port>`). An http destination is allowed only on one of them.
 *
 * A name under `localhost` is connected to `127.0.0.1` explicitly, never asked of the system resolver: the suite's
 * services listen there, while a resolver may answer such a name with `::1` first or only, or not at all. The address
 * and its `Host` stay the name as given.
 *
 * ```js
 * Loopback.is('snapshots.beyond.localhost');                // true
 * http.request(url, { lookup: Loopback.lookup });           // connects to 127.0.0.1 for that name
 * ```
 */
export class Loopback {
	static ADDRESS = '127.0.0.1';

	static #named(hostname) {
		const name = hostname.toLowerCase().replace(/\.$/, '');
		return name === 'localhost' || name.endsWith('.localhost');
	}

	/**
	 * Whether a hostname, as a URL gives it, is a loopback name
	 *
	 * @param {string} hostname
	 */
	static is(hostname) {
		return hostname === Loopback.ADDRESS || hostname === '[::1]' || Loopback.#named(hostname);
	}

	/**
	 * A `lookup` for `net.connect` and `http.request`: `127.0.0.1` for a name under `localhost`, the system's answer
	 * for any other name
	 *
	 * @param {string} hostname
	 * @param {object | Function} options
	 * @param {Function} [callback]
	 */
	static lookup(hostname, options, callback) {
		if (typeof options === 'function') [callback, options] = [options, {}];
		if (!Loopback.#named(hostname)) return lookup(hostname, options, callback);
		const address = Loopback.ADDRESS;
		if (options?.all) return process.nextTick(callback, null, [{ address, family: 4 }]);
		process.nextTick(callback, null, address, 4);
	}
}
