import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * The pairing codes of a service (`beyond-dev-pairing/1`): what a person copies from the command line into a
 * browser page so that the page receives a token.
 *
 * A code is 8 characters of Crockford's base-32 alphabet (40 random bits), shown as `XXXX-XXXX`. It is valid once,
 * for `Codes.LIFETIME` (10 minutes), and only its SHA-256 is kept, in memory. At most `Codes.LIMIT` (5) are
 * outstanding: a new one replaces the oldest. A wrong attempt counts against every code outstanding while it is
 * made, and `Codes.ATTEMPTS` (5) wrong attempts end a code; the attempt that ends one, and every attempt after it
 * while no new code was created, is answered `429 PAIRING_ATTEMPTS`.
 *
 * ```js
 * const codes = new Codes();
 * const { code, expires } = codes.create({ origins: ['https://packages.example'] });
 * codes.redeem('7kq2 mx9d');   // {origins} of the code, or {refusal: {status, code, message}}
 * ```
 */
export class Codes {
	static ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	static LENGTH = 8;
	static LIFETIME = 600000;
	static ATTEMPTS = 5;
	static LIMIT = 5;

	#outstanding = new Map();
	#exhausted = false;
	#clock;
	#lifetime;

	/**
	 * @param {{clock?: () => number, lifetime?: number}} [options] The time in milliseconds (tests give their own)
	 * and how long a code is valid
	 */
	constructor({ clock = Date.now, lifetime = Codes.LIFETIME } = {}) {
		this.#clock = clock;
		this.#lifetime = lifetime;
	}

	/**
	 * How many codes can be redeemed now
	 */
	get size() {
		this.#prune();
		return this.#outstanding.size;
	}

	/**
	 * A new code, which the caller shows once and never stores
	 *
	 * @param {{origins?: string[]}} [options] Origins, besides the allowed ones of the service, that may redeem it
	 * @returns {{code: string, expires: string, origins: string[]}}
	 */
	create({ origins = [] } = {}) {
		this.#prune();
		let value = '';
		for (let index = 0; index < Codes.LENGTH; index++) value += Codes.ALPHABET[randomInt(Codes.ALPHABET.length)];

		while (this.#outstanding.size >= Codes.LIMIT) this.#outstanding.delete(this.#outstanding.keys().next().value);
		const expires = this.#clock() + this.#lifetime;
		this.#outstanding.set(Codes.#hash(value), { expires, origins: new Set(origins), wrong: 0 });
		this.#exhausted = false;
		return { code: `${value.slice(0, 4)}-${value.slice(4)}`, expires: new Date(expires).toISOString(), origins: [...origins] };
	}

	/**
	 * Whether an outstanding code names an origin, which may then ask to redeem codes
	 *
	 * @param {string} origin
	 */
	names(origin) {
		this.#prune();
		return [...this.#outstanding.values()].some(({ origins }) => origins.has(origin));
	}

	/**
	 * Uses a code once
	 *
	 * @param {unknown} value What the person typed: case, spaces and the hyphen do not matter, and `I`, `L` and `O`
	 * are read as `1`, `1` and `0`
	 * @param {(origins: Set<string>) => boolean} [admits] Whether the origin of the request may redeem a code that
	 * names these origins; a code it may not redeem is left outstanding and refused with `PAIRING_ORIGIN`
	 * @returns {{origins: string[]} | {refusal: {status: number, code: string, message: string}}}
	 */
	redeem(value, admits = () => true) {
		this.#prune();
		const normalized = Codes.normalize(value);
		const hash = normalized && Codes.#hash(normalized);
		const found = hash && [...this.#outstanding.entries()].find(([key]) => Codes.#same(key, hash));

		if (found) {
			const [key, { origins }] = found;
			if (!admits(origins)) {
				return { refusal: { status: 403, code: 'PAIRING_ORIGIN', message: 'This code cannot be used from the origin of this page' } };
			}
			this.#outstanding.delete(key);
			return { origins: [...origins] };
		}
		return { refusal: this.#wrong() };
	}

	/**
	 * Counts a wrong attempt against every outstanding code and says how it is answered
	 */
	#wrong() {
		let ended = false;
		for (const [key, entry] of this.#outstanding) {
			if (++entry.wrong < Codes.ATTEMPTS) continue;
			this.#outstanding.delete(key);
			ended = true;
		}
		if (ended) this.#exhausted = true;
		if (ended || (this.#exhausted && !this.#outstanding.size)) {
			const message = `Too many wrong pairing codes: the codes that were outstanding ended. Ask for a new one with "beyond pair"`;
			return { status: 429, code: 'PAIRING_ATTEMPTS', message };
		}
		return { status: 401, code: 'PAIRING_CODE_INVALID', message: 'This pairing code is unknown, was used already or expired' };
	}

	#prune() {
		const now = this.#clock();
		for (const [key, { expires }] of this.#outstanding) if (expires <= now) this.#outstanding.delete(key);
	}

	/**
	 * The canonical form of a code as typed, or undefined when it cannot be one
	 *
	 * @param {unknown} value
	 * @returns {string | undefined}
	 */
	static normalize(value) {
		if (typeof value !== 'string' || value.length > 32) return;
		const text = value.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
		if (text.length !== Codes.LENGTH || [...text].some(character => !Codes.ALPHABET.includes(character))) return;
		return text;
	}

	static #hash(value) {
		return createHash('sha256').update(value).digest();
	}

	static #same(a, b) {
		return a.length === b.length && timingSafeEqual(a, b);
	}
}
