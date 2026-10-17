import { createHash, randomBytes } from 'node:crypto';

/**
 * The pairings of a service (`beyond-dev-pairing/1`): which browser origins hold a token, and until when.
 *
 * A token is 32 random bytes in base64url, given once to the page that redeemed a code and never again. The service
 * keeps its SHA-256 only. With a `Ledger`, the pairings are kept in the workspace's `.beyond/pairings.json` too, so a
 * service started again on the same workspace knows them (hashes only, never a token). A token is bound to the origin
 * that received it. Its expiry slides: each use renews it for `Pairings.TTL` (12 hours, `BEYOND_PAIRING_TTL`), never
 * past `Pairings.BOUND` (7 days) from its creation. A pairing ends when it expires or is revoked, which removes it from
 * the file; whoever observes it (an open event stream) is told why, and a token of an ended pairing is answered with
 * that reason (`PAIRING_EXPIRED`, `PAIRING_REVOKED`) rather than as unknown while this service runs.
 *
 * A pairing may name the Snapshots origin its page works with (`declare`), which the transfers it requests may upload
 * to.
 *
 * ```js
 * const pairings = new Pairings({ ledger });
 * const problem = pairings.load();                        // what the file held, or why it was not read
 * const { token, pairing } = pairings.issue('https://packages.example');
 * pairings.verify(token, 'https://packages.example');   // {pairing, …} or {refusal: {status, code, message}}
 * ```
 */
export class Pairings {
	static TTL = 43200000;

	/**
	 * The absolute bound of a pairing from its creation, however often it is used
	 */
	static BOUND = 7 * 86400000;

	/**
	 * How long a renewal may stay unwritten: a use renews the pairing in memory at once, and in the file at most this often
	 */
	static SAVE = 60000;

	/**
	 * How many ended pairings are remembered, so that their tokens are answered with the reason they ended
	 */
	static MEMORY = 256;

	#live = new Map();
	#ended = new Map();
	#clock;
	#ttl;
	#bound;
	#ledger;
	#report;

	/**
	 * @param {{clock?: () => number, ttl?: number, bound?: number, ledger?: import('./ledger.mjs').Ledger, report?:
	 * (message: string) => void}} [options] The time in milliseconds (tests give their own), the idle and absolute bounds,
	 * where pairings are kept between starts, and where a file that could not be written is reported
	 */
	constructor({ clock = Date.now, ttl = Pairings.TTL, bound = Pairings.BOUND, ledger, report = () => void 0 } = {}) {
		this.#clock = clock;
		this.#ttl = ttl;
		this.#bound = bound;
		this.#ledger = ledger;
		this.#report = report;
	}

	/**
	 * Reads the pairings an earlier start kept; the ones that expired since are removed from the file
	 *
	 * @returns {{code: string, message: string} | undefined} Why the file was not read, when it was not
	 */
	load() {
		if (!this.#ledger) return;
		const { entries, problem } = this.#ledger.read();
		const now = this.#clock();
		let dropped = false;
		for (const { hash, ...entry } of entries) {
			const expires = Math.min(entry.expires, entry.created + this.#bound);
			if (expires <= now || this.#live.has(hash)) {
				dropped = true;
				continue;
			}
			this.#add(hash, { ...entry, expires, saved: entry.used });
		}
		dropped && this.#save();
		return problem;
	}

	#add(hash, entry) {
		const live = { ...entry, listeners: new Set() };
		this.#live.set(hash, live);
		this.#schedule(hash, live);
		return live;
	}

	/**
	 * Tells the observers of a pairing when it expires: the timer is set for the expiry it knew, and set again when a
	 * use renewed it since
	 */
	#schedule(hash, entry) {
		clearTimeout(entry.timer);
		const wait = Math.max(0, Math.min(entry.expires - this.#clock(), 2 ** 31 - 1));
		entry.timer = setTimeout(() => (entry.expires <= this.#clock() ? this.#end(hash, 'PAIRING_EXPIRED') : this.#schedule(hash, entry)), wait);
		entry.timer.unref?.();
	}

	/**
	 * Pairs an origin
	 *
	 * @param {string} origin
	 * @param {{snapshots?: string}} [options] The Snapshots origin the page declared
	 * @returns {{token: string, expires: string, pairing: {id: string, origin: string, created: string, expires: string}}}
	 */
	issue(origin, { snapshots } = {}) {
		const token = randomBytes(32).toString('base64url');
		const now = this.#clock();
		const entry = { id: `prg_${randomBytes(6).toString('hex')}`, origin, created: now, used: now, saved: now, expires: Math.min(now + this.#ttl, now + this.#bound) };
		snapshots && (entry.snapshots = snapshots);
		const live = this.#add(Pairings.#hash(token), entry);
		this.#save();
		return { token, expires: new Date(live.expires).toISOString(), pairing: Pairings.#public(live) };
	}

	/**
	 * Whether a token is valid now for a request of an origin; a valid one is renewed
	 *
	 * @param {unknown} token
	 * @param {string | undefined} origin The origin of the request, undefined when it cannot be told
	 * @returns {{pairing: {id: string, origin: string, created: string, expires: string}, snapshots?: string, observe:
	 * (listener: (reason: string) => void) => () => void, leave: () => boolean, declare: (origin: string) => void} |
	 * {refusal: {status: number, code: string, message: string}}} A valid pairing, the Snapshots origin it declared, how
	 * to be told when it ends, how the page that holds it ends it, and how it declares its Snapshots origin
	 */
	verify(token, origin) {
		if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { refusal: Pairings.refusal('PAIRING_REQUIRED') };
		const hash = Pairings.#hash(token);
		const entry = this.#live.get(hash);
		if (entry && entry.expires <= this.#clock()) this.#end(hash, 'PAIRING_EXPIRED');

		const live = this.#live.get(hash);
		if (!live) return { refusal: Pairings.refusal(this.#ended.get(hash) ?? 'PAIRING_REQUIRED') };
		if (live.origin !== origin) return { refusal: Pairings.refusal('PAIRING_ORIGIN', live.origin) };

		this.#renew(live);
		const observe = listener => {
			live.listeners.add(listener);
			return () => live.listeners.delete(listener);
		};
		const declare = snapshots => {
			live.snapshots = snapshots;
			this.#save();
		};
		return { pairing: Pairings.#public(live), snapshots: live.snapshots, observe, leave: () => this.#end(hash, 'PAIRING_REVOKED'), declare };
	}

	/**
	 * A use renews a pairing for its idle bound, never past its absolute one, and writes it when the file is far behind
	 */
	#renew(entry) {
		const now = this.#clock();
		entry.used = now;
		entry.expires = Math.min(now + this.#ttl, entry.created + this.#bound);
		if (now - entry.saved < Pairings.SAVE) return;
		entry.saved = now;
		this.#save();
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
	 * @returns {{id: string, origin: string, created: string, used: string, expires: string, snapshots?: string}[]}
	 */
	get list() {
		const now = this.#clock();
		[...this.#live.entries()].forEach(([hash, { expires }]) => expires <= now && this.#end(hash, 'PAIRING_EXPIRED'));
		return [...this.#live.values()].map(entry => ({
			...Pairings.#public(entry),
			used: new Date(entry.used).toISOString(),
			...(entry.snapshots ? { snapshots: entry.snapshots } : {})
		}));
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
	 * The service stops: the renewals not written yet are, and nobody is told, the streams end with the service. The
	 * pairings stay in the file for the next start
	 */
	close() {
		const behind = [...this.#live.values()].some(entry => entry.used > entry.saved);
		this.#live.forEach(entry => clearTimeout(entry.timer));
		behind && this.#save();
		this.#live.clear();
	}

	#end(hash, reason) {
		const entry = this.#live.get(hash);
		if (!entry) return false;
		clearTimeout(entry.timer);
		this.#live.delete(hash);
		this.#ended.set(hash, reason);
		while (this.#ended.size > Pairings.MEMORY) this.#ended.delete(this.#ended.keys().next().value);
		this.#save();
		entry.listeners.forEach(listener => listener(reason));
		return true;
	}

	/**
	 * Writes every live pairing to the file; a file that cannot be written is reported, and the pairings stay valid in
	 * memory until the service stops
	 */
	#save() {
		if (!this.#ledger) return;
		const entries = [...this.#live.entries()].map(([hash, { id, origin, created, used, expires, snapshots }]) => ({ hash, id, origin, created, used, expires, snapshots }));
		try {
			this.#ledger.write(entries);
			this.#live.forEach(entry => (entry.saved = entry.used));
		} catch (error) {
			this.#report(`the pairings could not be written to .beyond/pairings.json (${error.code ?? error.message}): they last until the service stops`);
		}
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
