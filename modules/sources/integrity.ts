import { createHash, type Hash } from 'crypto';

const strength = ['sha512', 'sha384', 'sha256', 'sha1'];

/**
 * A subresource integrity value (`sha512-<base64>`), as registries publish it for an archive. When
 * several hashes are declared, the strongest supported one is the one verified.
 */
export /*bundle*/ class Integrity {
	#algorithm?: string;
	#digest?: string;

	get valid() {
		return !!this.#algorithm;
	}

	get algorithm() {
		return this.#algorithm;
	}

	/**
	 * The digest in hexadecimal: safe as a path or key segment, unlike base64
	 */
	get hex(): string {
		return Buffer.from(this.#digest, 'base64').toString('hex');
	}

	/**
	 * `<algorithm>-<hex>`
	 */
	get id(): string {
		return `${this.#algorithm}-${this.hex}`;
	}

	constructor(value: string) {
		if (typeof value !== 'string') return;

		const declared: Map<string, string> = new Map();
		for (const item of value.trim().split(/\s+/)) {
			const match = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/]+={0,2})(\?.*)?$/.exec(item);
			match && !declared.has(match[1]) && declared.set(match[1], match[2]);
		}

		this.#algorithm = strength.find(algorithm => declared.has(algorithm));
		this.#digest = this.#algorithm && declared.get(this.#algorithm);
	}

	hash(): Hash {
		return createHash(this.#algorithm);
	}

	/**
	 * Compares a computed hash with the declared digest
	 */
	matches(hash: Hash): boolean {
		const computed = hash.digest();
		const expected = Buffer.from(this.#digest, 'base64');
		return computed.length === expected.length && computed.equals(expected);
	}
}
