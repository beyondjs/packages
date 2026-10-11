import { createHash, randomBytes } from 'node:crypto';

/**
 * The pairings of a service (`beyond-dev-pairing/1`): which browser origins hold a token, and until when.
 *
 * A token is 32 random bytes in base64url, given once to the page that redeemed a code and never again. The service
 * keeps its SHA-256 only, in memory, so a token is gone when the service stops. A token is bound to the origin that
 * received it and valid for `Pairings.TTL` (12 hours, `BEYOND_PAIRING_TTL`) from then. A pairing ends when it
 * expires or is revoked; whoever observes it (an open event stream) is told why, and a token of an ended pairing is
 * answered with that reason (`PAIRING_EXPIRED`, `PAIRING_REVOKED`) rather than as unknown.
 *
 * ```js
 * const pairings = new Pairings();
 * const { token, pairing } = pairings.issue('https://packages.example');
 * pairings.verify(token, 'https://packages.example');   // {pairing} or {refusal: {status, code, message}}
 * ```
 */
export class Pairings {
	static TTL = 43200000;

	/**
	 * How many ended pairings are remembered, so that their tokens are answered with the reason they ended
	 */
	static MEMORY = 256;

	#live = new Map();
	#ended = new Map();
	#clock;
	#ttl;

	/**
	 * @param {{clock?: () => number, ttl?: number}} [options] The time in milliseconds (tests give their own) and
	 * how long a pairing lasts
	 */
	constructor({ clock = Date.now, ttl = Pairings.TTL } = {}) {
		this.#clock = clock;
		this.#ttl = ttl;
	}

	/**
	 * Pairs an origin
	 *
	 * @param {string} origin
	 * @returns {{token: string, expires: string, pairing: {id: string, origin: string, created: string, expires: string}}}
	 */
	issue(origin) {
		const token = randomBytes(32).toString('base64url');
		const now = this.#clock();
		const entry = {
			id: `prg_${randomBytes(6).toString('hex')}`,
			origin,
			created: now,
			used: now,
			expires: now + this.#ttl,
			listeners: new Set()
		};
		entry.timer = setTimeout(() => this.#end(Pairings.#hash(token), 'PAIRING_EXPIRED'), Math.min(this.#ttl, 2 ** 31 - 1));
		entry.timer.unref?.();
		this.#live.set(Pairings.#hash(token), entry);
		return { token, expires: new Date(entry.expires).toISOString(), pairing: Pairings.#public(entry) };
	}

	/**
	 * Whether a token is valid now for a request of an origin
	 *
	 * @param {unknown} token
	 * @param {string | undefined} origin The origin of the request, undefined when it cannot be told
	 * @returns {{pairing: {id: string, origin: string}, observe: (listener: (reason: string) => void) => () => void,
	 * leave: () => boolean} | {refusal: {status: number, code: string, message: string}}} A valid pairing, how to be
	 * told when it ends, and how the page that holds it ends it
	 */
	verify(token, origin) {
		if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { refusal: Pairings.refusal('PAIRING_REQUIRED') };
		const hash = Pairings.#hash(token);
		const entry = this.#live.get(hash);
		if (entry && entry.expires <= this.#clock()) this.#end(hash, 'PAIRING_EXPIRED');

		const live = this.#live.get(hash);
		if (!live) return { refusal: Pairings.refusal(this.#ended.get(hash) ?? 'PAIRING_REQUIRED') };
		if (live.origin !== origin) return { refusal: Pairings.refusal('PAIRING_ORIGIN', live.origin) };

		live.used = this.#clock();
		const observe = listener => {
			live.listeners.add(listener);
			return () => live.listeners.delete(listener);
		};
		return { pairing: Pairings.#public(live), observe, leave: () => this.#end(hash, 'PAIRING_REVOKED') };
	}

	/**
	 * Revokes one pairing by its identifier, or every pairing without one
	 *
	 * @param {string} [id]
	 * @returns {number} How many pairings ended
	 */
	revoke(id) {
		const hashes = [...this.#live.entries()].filter(([, entry]) => id === undefined || entry.id === id).map(([hash]) => hash);
		hashes.forEach(hash => this.#end(hash, 'PAIRING_REVOKED'));
		return hashes.length;
	}

	/**
	 * The pairings that are valid now
	 *
	 * @returns {{id: string, origin: string, created: string, used: string, expires: string}[]}
	 */
	get list() {
		const now = this.#clock();
		[...this.#live.entries()].forEach(([hash, { expires }]) => expires <= now && this.#end(hash, 'PAIRING_EXPIRED'));
		return [...this.#live.values()].map(entry => ({ ...Pairings.#public(entry), used: new Date(entry.used).toISOString() }));
	}

	/**
	 * Whether a valid pairing belongs to an origin
	 *
	 * @param {string} origin
	 */
	names(origin) {
		const now = this.#clock();
		return [...this.#live.values()].some(entry => entry.origin === origin && entry.expires > now);
	}

	/**
	 * Ends every pairing because the service stops; nobody is told, the streams end with the service
	 */
	close() {
		this.#live.forEach(({ timer }) => clearTimeout(timer));
		this.#live.clear();
	}

	#end(hash, reason) {
		const entry = this.#live.get(hash);
		if (!entry) return false;
		clearTimeout(entry.timer);
		this.#live.delete(hash);
		this.#ended.set(hash, reason);
		while (this.#ended.size > Pairings.MEMORY) this.#ended.delete(this.#ended.keys().next().value);
		entry.listeners.forEach(listener => listener(reason));
		return true;
	}

	/**
	 * The answer to a browser request that a pairing does not admit
	 *
	 * @param {'PAIRING_REQUIRED' | 'PAIRING_EXPIRED' | 'PAIRING_REVOKED' | 'PAIRING_ORIGIN'} code
	 * @param {string} [origin] The origin of the pairing, for `PAIRING_ORIGIN`
	 */
	static refusal(code, origin) {
		const again = 'pair this page again with a new code (run "beyond pair" where the service runs)';
		const messages = {
			PAIRING_REQUIRED: `This page is not paired with this development service: ${again}`,
			PAIRING_EXPIRED: `The pairing of this page expired: ${again}`,
			PAIRING_REVOKED: `The pairing of this page was revoked: ${again}`,
			PAIRING_ORIGIN: `This token was paired from another origin (${origin}); a page pairs from its own origin`
		};
		return { status: code === 'PAIRING_ORIGIN' ? 403 : 401, code, message: messages[code] };
	}

	static #public({ id, origin, created, expires }) {
		return { id, origin, created: new Date(created).toISOString(), expires: new Date(expires).toISOString() };
	}

	static #hash(token) {
		return createHash('sha256').update(token).digest('hex');
	}
}
