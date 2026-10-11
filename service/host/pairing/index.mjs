import { Deadline } from '../../deadline.mjs';
import { Codes } from './codes.mjs';
import { Cors } from './cors.mjs';
import { Origins } from './origins.mjs';
import { Pairings } from './pairings.mjs';
import { PairingRoutes } from './routes.mjs';
import { Policy } from './policy.mjs';

export { Caller } from './caller.mjs';

/**
 * Pairing, for a service started with the `pairing` setting, as the command line starts it: who may use the service
 * from a browser, and what a process of the machine may do (`beyond-dev-pairing/1`).
 *
 * A local tool, which presents the service's local credential, creates a one-use code (`POST /pairing/codes`); the
 * person types it in a page of an allowed interface origin, and the page exchanges it for a token (`POST /pairing`)
 * that it presents in `Authorization: Bearer` from then on. The allowed interface origins are the API listener's own
 * origins (where the fallback interface runs), the configured ones (`origins`: the Packages interface the command
 * line was given), the origins an outstanding code names and the origin of every valid pairing; never the preview
 * listener's. Every new pairing is announced (`announce('paired', {id, origin})`), so the command line names it.
 *
 * ```js
 * const pairing = new Pairing({ origins: ['https://packages.example'], embeds: [] }, { hosts, session, credential });
 * pairing.guard(app);   // the cross-origin rules and the access policy, before every route
 * pairing.setup(app);   // the routes of the protocol
 * pairing.listen({ api: 4000, preview: 4001, publics: {} });
 * ```
 *
 * A service started without the setting does not construct this.
 */
export class Pairing {
	/**
	 * The variable that bounds how long a pairing lasts, in milliseconds
	 */
	static TTL = new Deadline('BEYOND_PAIRING_TTL', Pairings.TTL);

	#codes;
	#pairings;
	#origins;
	#policy;
	#cors;
	#routes;
	#announce;

	/**
	 * @param {true | {origins?: string[], embeds?: string[]}} settings The `pairing` setting of the service
	 * @param {{hosts: import('../hosts.mjs').Hosts, session: () => Promise<object>, credential: string,
	 * environment?: object, clock?: () => number, announce?: (type: string, data: object) => void}} context The names
	 * requests may address, the session description a paired page receives, the local credential, the environment
	 * (`BEYOND_PAIRING_TTL`, `BEYOND_EMBED_ORIGINS`), the time (tests give their own) and where new pairings are told
	 */
	constructor(settings, { hosts, session, credential, environment = process.env, clock, announce = () => void 0 }) {
		const given = settings === true ? {} : (settings ?? {});
		const embeds = [...(given.embeds ?? []), ...String(environment.BEYOND_EMBED_ORIGINS ?? '').split(',').map(one => one.trim()).filter(Boolean)];
		this.#origins = new Origins({ interfaces: given.origins ?? [], embeds });
		this.#codes = new Codes({ clock });
		this.#pairings = new Pairings({ clock, ttl: Pairing.TTL.read(environment) });
		const previews = origin => this.#origins.previews(origin) || this.allows(origin);
		this.#policy = new Policy(hosts, this.#pairings, { credential, previews });
		this.#cors = new Cors((origin, request) => (this.#policy.previewing(request) ? previews(origin) : this.allows(origin)));
		this.#routes = new PairingRoutes(this, session);
		this.#announce = announce;
	}

	/**
	 * What `/session` lists for pairing
	 */
	get capabilities() {
		return { pairing: 1 };
	}

	/**
	 * The interface origins a code can be redeemed from: the API listener's own and the configured ones
	 */
	get origins() {
		return this.#origins.interfaces;
	}

	/**
	 * Whether pages of an origin may pair and read the answers of the API listener now
	 *
	 * @param {string} origin
	 */
	allows(origin) {
		return this.#origins.interface(origin) || this.#codes.names(origin) || this.#pairings.names(origin);
	}

	/**
	 * Whether an origin is one of the preview listener's own, which never pairs
	 *
	 * @param {string} origin
	 */
	preview(origin) {
		return this.#origins.preview(origin);
	}

	/**
	 * A new code, redeemable from the allowed origins and from the ones given, none of which is the preview's
	 *
	 * @param {string[]} [origins]
	 */
	code(origins = []) {
		const extra = origins.filter(origin => !this.#origins.interface(origin) && !this.#origins.preview(origin));
		const created = this.#codes.create({ origins: extra });
		return { ...created, origins: [...new Set([...this.origins, ...extra])] };
	}

	/**
	 * Exchanges a code for a token bound to the origin of the page, and announces the new pairing
	 *
	 * @param {unknown} code
	 * @param {string} origin
	 */
	redeem(code, origin) {
		const admits = origins => origins.has(origin) || this.#origins.interface(origin);
		const { refusal } = this.#codes.redeem(code, admits);
		if (refusal) return { refusal };
		const issued = this.#pairings.issue(origin);
		this.#announce('paired', { id: issued.pairing.id, origin: issued.pairing.origin });
		return issued;
	}

	/**
	 * The valid pairings
	 */
	get list() {
		return this.#pairings.list;
	}

	/**
	 * Revokes one pairing, or all of them
	 *
	 * @param {string} [id]
	 * @returns {number} How many ended
	 */
	revoke(id) {
		return this.#pairings.revoke(id);
	}

	/**
	 * Mounts, before every route of the service: the cross-origin rules of the allowed origins of each listener and
	 * the access policy
	 *
	 * @param {import('express').Application} app
	 */
	guard(app) {
		this.#cors.setup(app);
		this.#policy.setup(app);
	}

	/**
	 * Mounts the routes of the protocol
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#routes.setup(app);
	}

	/**
	 * The service listens: the origins of its two listeners, loopback and public, are known
	 *
	 * @param {{api: number, preview: number, publics?: {api?: string, preview?: string}}} listening
	 */
	listen({ api, preview, publics = {} }) {
		this.#origins.listen({ api, preview, publics });
		this.#policy.listen({ preview, exposed: !!(publics.api || publics.preview) });
	}

	/**
	 * The service stops: every pairing ends with it
	 */
	close() {
		this.#pairings.close();
	}
}
