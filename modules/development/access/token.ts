import { verify, type KeyObject } from 'crypto';
import { DevelopmentError } from '../error';

/**
 * A received JWS compact serialization signed with EdDSA (Ed25519): the envelope of delegated grants and of
 * revocation lists. The algorithm is fixed by the protocol and never negotiated from the received header.
 */
export class Token {
	#header: { alg: string; typ: string; kid: string };
	get header() {
		return this.#header;
	}

	#payload: Record<string, any>;
	get payload() {
		return this.#payload;
	}

	#signed: string;
	#signature: Buffer;

	constructor(serialization: unknown) {
		const fail = (reason: string) => new DevelopmentError('GRANT_MALFORMED', `Malformed token: ${reason}`, 401);

		if (typeof serialization !== 'string') throw fail('missing');
		const parts = serialization.split('.');
		if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw fail('not a compact serialization');
		try {
			this.#header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
			this.#payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
		} catch {
			throw fail('contents are not JSON');
		}
		if (this.#header?.alg !== 'EdDSA') throw fail(`algorithm "${this.#header?.alg}"`);
		if (typeof this.#header.kid !== 'string' || typeof this.#header.typ !== 'string') throw fail('missing key or type');
		if (!this.#payload || typeof this.#payload !== 'object') throw fail('payload is not an object');

		this.#signed = `${parts[0]}.${parts[1]}`;
		this.#signature = Buffer.from(parts[2], 'base64url');
	}

	verified(key: KeyObject): boolean {
		return verify(null, Buffer.from(this.#signed), key, this.#signature);
	}
}
