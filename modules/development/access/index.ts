import type { Request } from 'express';
import { Verifier, type IAuthority, type IClaims } from './verifier';

type Ended = (reason: 'GRANT_EXPIRED' | 'GRANT_REVOKED') => void;

/**
 * Who may do what on this service.
 *
 * In a Workspace project environment the mode is `delegated`: every route needs a grant signed by the central
 * administration, and open streams end when their grant expires or is revoked. Without an authority the mode
 * is `local`: the standalone command-line service keeps its own loopback and owner-token rules, and this
 * object allows every request.
 */
export /*bundle*/ class Access {
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
	 * @returns The verified claims, undefined in local mode
	 * @throws DevelopmentError 401 or 403
	 */
	require(request: Request, capability: string): IClaims | undefined {
		if (!this.#verifier) return;
		const address = request.socket.remoteAddress ?? '';
		if (this.#loopback && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return;
		const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
		return this.#verifier.verify(bearer, capability, Math.floor(Date.now() / 1000));
	}

	/**
	 * Register an open stream so that it ends with its grant
	 *
	 * @returns The function that unregisters it
	 */
	stream(claims: IClaims | undefined, ended: Ended): () => void {
		if (!claims) return () => undefined;
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
