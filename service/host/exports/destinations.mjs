import { Transfer } from './transfer.mjs';

/**
 * The Snapshots origins a transfer may upload to, for the caller that requests it: the union of
 *
 * 1. the origins of `BEYOND_SNAPSHOTS_ORIGINS` (separated by commas), when the service was started with it;
 * 2. the family's own Snapshots, `Destinations.FAMILY` (`https://snapshots.beyondjs.com`);
 * 3. the origin the paired page declared for its own pairing (`POST /pairing {code, snapshots}`, `PUT /pairing`),
 *    for the transfers requested with that pairing's token only;
 * 4. the `snapshots.origins` setting, read at each transfer.
 *
 * Each one is https, or http on a loopback name (`Transfer.secure`).
 *
 * ```js
 * const destinations = new Destinations({ environment: process.env, settings: () => ['https://snapshots.example'] });
 * destinations.for(Caller.of(request));   // ['https://snapshots.beyondjs.com', 'https://snapshots.example', …]
 * ```
 */
export class Destinations {
	static FAMILY = 'https://snapshots.beyondjs.com';

	#environment;
	#settings;

	/**
	 * @param {{environment?: object, settings?: () => unknown}} [options] The environment the service started with,
	 * and the value of the `snapshots.origins` setting now
	 * @throws {Error} For a variable that names something that is not an allowed origin, which fails the start of the
	 * service
	 */
	constructor({ environment = process.env, settings = () => [] } = {}) {
		this.#environment = Destinations.origins(environment);
		this.#settings = settings;
	}

	/**
	 * The allowed Snapshots origins an environment names: https origins, or http ones on a loopback name (`127.0.0.1`,
	 * `[::1]`, `localhost` and every name under it, such as `http://snapshots.beyond.localhost:<port>`)
	 *
	 * @param {object} environment
	 * @returns {string[]}
	 * @throws {Error} For a value that is not one
	 */
	static origins(environment) {
		const values = String(environment.BEYOND_SNAPSHOTS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
		return values.map(value => {
			let url;
			try {
				url = new URL(value);
			} catch {
				throw new Error(`BEYOND_SNAPSHOTS_ORIGINS names "${value}", which is not an origin`);
			}
			if (!Transfer.secure(url)) throw new Error(`BEYOND_SNAPSHOTS_ORIGINS names "${value}", which is neither an https origin nor an http one on a loopback name`);
			return url.origin;
		});
	}

	/**
	 * The origins the setting holds now, the valid ones only
	 */
	#configured() {
		const value = this.#settings();
		const list = Array.isArray(value) ? value : [];
		return list.filter(origin => {
			try {
				return typeof origin === 'string' && Transfer.secure(new URL(origin)) && new URL(origin).origin === origin;
			} catch {
				return false;
			}
		});
	}

	/**
	 * The origins a caller's transfers may upload to
	 *
	 * @param {{snapshots?: string} | undefined} caller The caller of the request (`Caller`), whose declared origin counts
	 * @returns {string[]}
	 */
	for(caller) {
		const declared = caller?.snapshots ? [caller.snapshots] : [];
		return [...new Set([...this.#environment, Destinations.FAMILY, ...declared, ...this.#configured()])];
	}
}
