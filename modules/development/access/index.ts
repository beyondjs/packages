import type { Request } from 'express';
import { DevelopmentError } from '../error';
import { Verifier, type IAuthority, type IClaims } from './verifier';

/**
 * Why an open stream ends: its grant expired or was revoked (delegated access), or the pairing of the page that
 * opened it did (a service that pairs browsers)
 */
export /*bundle*/ type EndReason = 'GRANT_EXPIRED' | 'GRANT_REVOKED' | 'PAIRING_EXPIRED' | 'PAIRING_REVOKED';

type Ended = (reason: EndReason) => void;

/**
 * The decision a hosting service that pairs browsers leaves on each request, under `Access.CALLER`: who sent it
 * (a local process, a paired page or a visitor) and what it may do. This module keeps no pairing, user or role of its
 * own; it reads the decision.
 */
export /*bundle*/ interface ICaller {
	readonly kind: 'local' | 'paired' | 'visitor';
	allows(capability: string): boolean;
	refusal(capability: string): { status: number; code: string; message: string } | undefined;
	ended(listener: (reason: EndReason) => void): () => void;
}

/**
 * Who may do what on this service.
 *
 * In a Workspace project environment the mode is `delegated`: every route needs a grant signed by the central
 * administration, and open streams end when their grant expires or is revoked. Without an authority the mode
 * is `local`: the standalone command-line service keeps its own loopback and owner-token rules, and this object
 * allows every request, unless the hosting service pairs browsers: it then leaves its decision on the request
 * (`ICaller`), and a capability the caller lacks is refused with the caller's reason (`PAIRING_REQUIRED`,
 * `PAIRING_EXPIRED`, `PAIRING_REVOKED`, `PAIRING_ORIGIN`), a visitor holds `artifacts.read` and
 * `events.subscribe` only, and a stream a paired page opened ends with its pairing.
 */
export /*bundle*/ class Access {
	/**
	 * Where a hosting service that pairs browsers leaves its decision on a request: a registered symbol, which the
	 * service and this module name alike without importing one another
	 */
	static CALLER = Symbol.for('beyond.caller');

	#verifier: Verifier;
	get verifier() {
		return this.#verifier;
	}

	get mode(): 'delegated' | 'local' {
		return this.#verifier ? 'delegated' : 'local';
	}

	#streams = new Map<Ended, { claims: IClaims; timer: ReturnType<typeof setTimeout> }>();
	#loopback: boolean;

	/**
	 * @param loopback Let requests from the loopback interface through without a grant. Inside a project
	 *   container those come from processes that already hold the working copy: the service's own supervisor,
	 *   consumers and agent tools. Requests routed from outside never arrive on loopback. It must stay off
	 *   wherever a proxy in the same network namespace forwards external requests.
	 */
	constructor(authority?: IAuthority, loopback = false) {
		this.#verifier = authority && new Verifier(authority);
		this.#loopback = loopback;
	}

	/**
	 * @param environment Variables `BEYOND_AUTHORITY` (issuer and public keys, JSON), `BEYOND_ENVIRONMENT` and
	 *   `BEYOND_TRUST_LOOPBACK=1`
	 */
	static from(environment: NodeJS.ProcessEnv): Access {
		const { BEYOND_AUTHORITY: authority, BEYOND_ENVIRONMENT: identifier } = environment;
		if (!authority) return new Access();
		if (!identifier) throw new Error('BEYOND_AUTHORITY is set without BEYOND_ENVIRONMENT');
		return new Access({ ...JSON.parse(authority), environment: identifier }, environment.BEYOND_TRUST_LOOPBACK === '1');
	}

	/**
	 * The decision a hosting service that pairs browsers left on a request, if any
	 */
	static #caller(request: Request): ICaller | undefined {
		return (request as unknown as Record<symbol, ICaller | undefined>)[Access.CALLER];
	}

	/**
	 * @returns The verified claims, undefined in local mode
	 * @throws DevelopmentError 401 or 403
	 */
	require(request: Request, capability: string): IClaims | undefined {
		if (!this.#verifier) {
			const refusal = Access.#caller(request)?.refusal(capability);
			if (refusal) throw new DevelopmentError(refusal.code, refusal.message, refusal.status);
			return;
		}
		const address = request.socket.remoteAddress ?? '';
		if (this.#loopback && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return;
		const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
		return this.#verifier.verify(bearer, capability, Math.floor(Date.now() / 1000));
	}

	/**
	 * Whether the access a request was admitted with includes a capability: the grant's capabilities in delegated
	 * mode, the caller's in local mode, everything without either
	 */
	includes(request: Request, claims: IClaims | undefined, capability: string): boolean {
		if (claims) return claims.cap.includes(capability);
		return Access.#caller(request)?.allows(capability) ?? true;
	}

	/**
	 * Register an open stream so that it ends with its grant, or with the pairing of the page that opened it
	 *
	 * @param request The request that opened it, whose caller a hosting service that pairs browsers decided
	 * @returns The function that unregisters it
	 */
	stream(claims: IClaims | undefined, ended: Ended, request?: Request): () => void {
		if (!claims) {
			const caller = request && Access.#caller(request);
			return caller ? caller.ended(ended) : () => undefined;
		}
		const remaining = Math.min(Math.max(claims.exp * 1000 - Date.now(), 0), 2 ** 31 - 1);
		const timer = setTimeout(() => (this.#streams.delete(ended), ended('GRANT_EXPIRED')), remaining);
		this.#streams.set(ended, { claims, timer });
		return () => {
			clearTimeout(timer);
			this.#streams.delete(ended);
		};
	}

	/**
	 * Accept a signed revocation list and end the streams of the grants it revokes
	 */
	revocations(serialization: string): number {
		const sequence = this.#verifier.revocations(serialization);
		for (const [ended, { claims, timer }] of [...this.#streams]) {
			if (!this.#verifier.revoked(claims)) continue;
			clearTimeout(timer);
			this.#streams.delete(ended);
			ended('GRANT_REVOKED');
		}
		return sequence;
	}
}
