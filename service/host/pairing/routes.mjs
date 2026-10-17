import { Body, BodyError } from '../body.mjs';
import { Origin } from '../settings/values.mjs';
import { Caller } from './caller.mjs';
import { Policy } from './policy.mjs';

/**
 * The HTTP mapping of `beyond-dev-pairing/1`:
 *
 * | Route | Caller | Answer |
 * | --- | --- | --- |
 * | `POST /pairing/codes` (`{origins?}` or no body) | A local tool (the local credential) | `201 {code, expires, origins, fragment}` |
 * | `POST /pairing` `{code, snapshots?}` | A browser page of an allowed interface origin | `201 {token, expires, pairing: {id, origin, created}, session}` |
 * | `PUT /pairing` `{snapshots}` | The paired page | `204`: the Snapshots origin of its pairing |
 * | `DELETE /pairing` | The paired page | `204`: its pairing ends |
 * | `GET /pairings`, `DELETE /pairings`, `DELETE /pairings/:id` | A local tool | The pairings, and their revocation |
 * | `GET /session` without a token | A browser page of an allowed interface origin | `200 {protocol, capabilities, pairing: null}` |
 *
 * A route of local tools is refused to any other caller with `401 CREDENTIAL_REQUIRED`, a paired page included: a
 * pairing never creates another one. Every answer is `no-store`, and a code or a token is never logged or written to
 * disk. A code may travel in the fragment of an interface link (`fragment`, `code=XXXX-XXXX`), which a browser never
 * sends to a server or in a `Referer`; never in a query. A page without a token learns only what the service
 * implements from `GET /session`; any other caller is answered with the refusal its credentials give.
 */
export class PairingRoutes {
	static LIMIT = 4096;

	/**
	 * The most origins a code may name besides the allowed ones of the service
	 */
	static ORIGINS = 8;

	#pairing;
	#session;

	/**
	 * @param {import('./index.mjs').Pairing} pairing
	 * @param {() => Promise<object>} session The session description a page receives with its token
	 */
	constructor(pairing, session) {
		this.#pairing = pairing;
		this.#session = session;
	}

	static #answer(response, status, body) {
		response.status(status).set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
		body === undefined ? response.end() : response.json(body);
	}

	static #refuse(response, status, code, message) {
		PairingRoutes.#answer(response, status, { error: { code, message } });
	}

	/**
	 * Refuses a caller without the local credential on a route of local tools; true when it was refused
	 */
	static #local(request, response) {
		if (Caller.of(request)?.kind === 'local') return false;
		const message = 'Only the command line of the machine where the service runs creates pairing codes and manages pairings, with the local credential: run "beyond pair" there';
		PairingRoutes.#refuse(response, 401, 'CREDENTIAL_REQUIRED', message);
		return true;
	}

	/**
	 * The origins a request to create a code names: valid http or https origins, none of them the preview's
	 */
	#origins(body) {
		const { origins = [] } = body;
		const invalid = message => new BodyError(400, 'PAIRING_ORIGINS_INVALID', message);
		if (!Array.isArray(origins) || origins.length > PairingRoutes.ORIGINS) throw invalid(`"origins" is a list of at most ${PairingRoutes.ORIGINS} origins`);
		return origins.map(value => {
			let url;
			try {
				url = new URL(value);
			} catch {
				throw invalid(`"${value}" is not an origin`);
			}
			if (!['http:', 'https:'].includes(url.protocol) || url.origin !== String(value).replace(/\/$/, '')) throw invalid(`"${value}" is not an http or https origin`);
			if (this.#pairing.preview(url.origin)) throw invalid(`${url.origin} is the origin of the preview listener, which never pairs`);
			return url.origin;
		});
	}

	async #code(request, response) {
		if (PairingRoutes.#local(request, response)) return;
		const body = await new Body(request, { limit: PairingRoutes.LIMIT, empty: true }).read();
		const created = this.#pairing.code(this.#origins(body));
		PairingRoutes.#answer(response, 201, { ...created, fragment: `code=${created.code}` });
	}

	/**
	 * The Snapshots origin a page declares: https, or http on a loopback name or one under `localhost`, with no path,
	 * query, fragment or credentials
	 *
	 * @throws {BodyError} `400 PAIRING_DESTINATION_INVALID`
	 */
	static destination(value) {
		const parsed = value === null ? { message: 'null' } : new Origin().parse(value);
		if (parsed.message) {
			const message = 'The Snapshots origin is https, or http on a loopback name, with no path, query, fragment or credentials, such as "https://snapshots.example.com"';
			throw new BodyError(400, 'PAIRING_DESTINATION_INVALID', message);
		}
		return parsed.value;
	}

	async #pair(request, response) {
		const origin = request.headers.origin;
		if (Caller.of(request)?.kind === 'local' || !origin || origin === 'null') {
			return PairingRoutes.#refuse(response, 403, 'PAIRING_ORIGIN', 'A pairing binds the origin of a browser page, and this request names none');
		}
		if (!this.#pairing.allows(origin)) {
			return PairingRoutes.#refuse(response, 403, 'PAIRING_ORIGIN', `Pages of ${origin} cannot pair with this service: it is not one of its interface origins`);
		}

		const { code, snapshots } = await new Body(request, { limit: PairingRoutes.LIMIT }).read();
		// A declaration that is not an origin is refused before the code is used, which stays valid for another attempt
		const declared = snapshots === undefined ? void 0 : PairingRoutes.destination(snapshots);
		const redeemed = this.#pairing.redeem(code, origin, { snapshots: declared });
		if (redeemed.refusal) return PairingRoutes.#refuse(response, redeemed.refusal.status, redeemed.refusal.code, redeemed.refusal.message);

		const { token, expires, pairing } = redeemed;
		const session = await this.#session();
		PairingRoutes.#answer(response, 201, { token, expires, pairing: { id: pairing.id, origin: pairing.origin, created: pairing.created }, session });
	}

	async #declare(request, response) {
		const caller = Caller.of(request);
		if (caller?.kind !== 'paired') return PairingRoutes.#refuse(response, 404, 'PAIRING_NOT_FOUND', 'This request presents no pairing to declare a Snapshots origin for');
		const { snapshots } = await new Body(request, { limit: PairingRoutes.LIMIT }).read();
		caller.declare(PairingRoutes.destination(snapshots));
		PairingRoutes.#answer(response, 204);
	}

	/**
	 * What a page without a token learns: what the service implements, and that it is not paired. Any other caller
	 * reaches the session route, or its refusal
	 */
	async #probe(request, response, next) {
		const caller = Caller.of(request);
		if (caller?.kind !== 'visitor') return next();
		const { origin } = request.headers;
		const anonymous = request.headers.authorization === undefined && Policy.browser(request) && origin && origin !== 'null' && this.#pairing.allows(origin);
		if (!anonymous) {
			const { status, code, message } = caller.refusal('session.read');
			return PairingRoutes.#refuse(response, status, code, message);
		}
		const { protocol, capabilities } = await this.#session();
		PairingRoutes.#answer(response, 200, { protocol, capabilities, pairing: null });
	}

	#leave(request, response) {
		const caller = Caller.of(request);
		if (caller?.kind !== 'paired') return PairingRoutes.#refuse(response, 404, 'PAIRING_NOT_FOUND', 'This request presents no pairing to end');
		caller.leave();
		PairingRoutes.#answer(response, 204);
	}

	#list(request, response) {
		if (PairingRoutes.#local(request, response)) return;
		PairingRoutes.#answer(response, 200, { pairings: this.#pairing.list });
	}

	#revoke(request, response, id) {
		if (PairingRoutes.#local(request, response)) return;
		const ended = this.#pairing.revoke(id);
		if (id !== undefined && !ended) return PairingRoutes.#refuse(response, 404, 'PAIRING_NOT_FOUND', `There is no pairing "${id}"`);
		PairingRoutes.#answer(response, 204);
	}

	/**
	 * Mounts the routes. They answer their own refusals, in the envelope of the service.
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const route = handler => (request, response, next) =>
			Promise.resolve()
				.then(() => handler(request, response, next))
				.catch(error => (error instanceof BodyError ? PairingRoutes.#answer(response, error.status, error.body) : next(error)));

		app.post('/pairing/codes', route((request, response) => this.#code(request, response)));
		app.post('/pairing', route((request, response) => this.#pair(request, response)));
		app.put('/pairing', route((request, response) => this.#declare(request, response)));
		app.get('/session', route((request, response, next) => this.#probe(request, response, next)));
		app.delete('/pairing', route((request, response) => this.#leave(request, response)));
		app.get('/pairings', route((request, response) => this.#list(request, response)));
		app.delete('/pairings', route((request, response) => this.#revoke(request, response)));
		app.delete('/pairings/:id', route((request, response) => this.#revoke(request, response, request.params.id)));
	}
}
