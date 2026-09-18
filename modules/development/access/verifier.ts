import { createPublicKey, type KeyObject } from 'crypto';
import { DevelopmentError } from '../error';
import { Token } from './token';

export /*bundle*/ interface IAuthority {
	issuer: string;
	environment: string;
	keys: { kid: string; public: string }[];
}

export /*bundle*/ interface IClaims {
	iss: string;
	aud: string;
	sub: string;
	prj: string;
	jti: string;
	iat: number;
	exp: number;
	cap: string[];
	act: { kind: string; task?: string };
}

/**
 * Verification of `beyond-dev-grant/1` grants and `beyond-dev-revocations/1` lists signed by the central
 * administration. It holds public keys, this environment's identifier and the newest revocation list. It
 * holds no users, teams or roles: whether a user may receive a capability was decided before signing.
 */
export /*bundle*/ class Verifier {
	static SKEW = 30;

	#issuer: string;
	#environment: string;
	#keys = new Map<string, KeyObject>();

	#sequence = 0;
	get sequence() {
		return this.#sequence;
	}
	#grants = new Set<string>();
	#subjects = new Map<string, number>();

	constructor({ issuer, environment, keys }: IAuthority) {
		this.#issuer = issuer;
		this.#environment = environment;
		for (const { kid, public: pem } of keys) this.#keys.set(kid, createPublicKey(pem));
	}

	#envelope(serialization: unknown, type: string): Record<string, any> {
		const refuse = (code: string, message: string) => new DevelopmentError(code, message, 401);
		const token = new Token(serialization);
		if (token.header.typ !== type) throw refuse('GRANT_MALFORMED', `Unexpected token type "${token.header.typ}"`);

		const key = this.#keys.get(token.header.kid);
		if (!key) throw refuse('GRANT_KEY', `Unknown signing key "${token.header.kid}"`);
		if (!token.verified(key)) throw refuse('GRANT_SIGNATURE', 'The signature does not match');
		if (token.payload.iss !== this.#issuer) throw refuse('GRANT_ISSUER', `Unexpected issuer "${token.payload.iss}"`);
		if (token.payload.aud !== this.#environment) throw refuse('GRANT_AUDIENCE', 'The token was issued for another environment');
		return token.payload;
	}

	revoked({ jti, sub, iat }: IClaims): boolean {
		if (this.#grants.has(jti)) return true;
		const before = this.#subjects.get(sub);
		return before !== undefined && iat <= before;
	}

	/**
	 * Accept or refuse a grant for one capability at one moment
	 *
	 * @param now Seconds
	 */
	verify(serialization: unknown, capability: string, now: number): IClaims {
		const claims = this.#envelope(serialization, 'beyond-dev-grant/1') as IClaims;
		const refuse = (code: string, message: string, status = 401) => new DevelopmentError(code, message, status);

		if (!Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || !Array.isArray(claims.cap)) {
			throw refuse('GRANT_MALFORMED', 'Missing validity or capabilities');
		}
		if (now >= claims.exp) throw refuse('GRANT_EXPIRED', 'The grant expired');
		if (claims.iat > now + Verifier.SKEW) throw refuse('GRANT_EXPIRED', 'The grant is not valid yet');
		if (this.revoked(claims)) throw refuse('GRANT_REVOKED', 'The grant was revoked');
		if (!claims.cap.includes(capability)) throw refuse('GRANT_CAPABILITY', `The grant does not include "${capability}"`, 403);
		return claims;
	}

	/**
	 * Replace the revocation list with a newer signed one. Lists are complete and ordered, so delivery can be
	 * repeated, pushed and pulled: an older or equal list never replaces a newer one.
	 */
	revocations(serialization: unknown): number {
		const list = this.#envelope(serialization, 'beyond-dev-revocations/1');
		if (!Number.isInteger(list.seq) || !Array.isArray(list.grants) || !Array.isArray(list.subjects)) {
			throw new DevelopmentError('GRANT_MALFORMED', 'Invalid revocation list', 401);
		}
		if (list.seq <= this.#sequence) throw new DevelopmentError('REVOCATIONS_STALE', `Sequence ${list.seq} is not newer`, 409);

		this.#sequence = list.seq;
		this.#grants = new Set(list.grants);
		this.#subjects = new Map(list.subjects.map(({ sub, before }: { sub: string; before: number }) => [sub, before]));
		return this.#sequence;
	}
}
