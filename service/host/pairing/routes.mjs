import { Body, BodyError } from '../body.mjs';
import { Caller } from './caller.mjs';

/**
 * The HTTP mapping of `beyond-dev-pairing/1`:
 *
 * | Route | Caller | Answer |
 * | --- | --- | --- |
 * | `POST /pairing/codes` (`{origins?}` or no body) | A local tool (the local credential) | `201 {code, expires, origins}` |
 * | `POST /pairing` `{code}` | A browser page of an allowed interface origin | `201 {token, expires, pairing: {id, origin, created}, session}` |
 * | `DELETE /pairing` | The paired page | `204`: its pairing ends |
 * | `GET /pairings`, `DELETE /pairings`, `DELETE /pairings/:id` | A local tool | The pairings, and their revocation |
 *
 * A route of local tools is refused to any other caller with `401 CREDENTIAL_REQUIRED`, a paired page included: a
 * pairing never creates another one. Every answer is `no-store`, and a code or a token is never logged, written to
 * disk or put in an address.
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
		PairingRoutes.#answer(response, 201, this.#pairing.code(this.#origins(body)));
	}

	async #pair(request, response) {
		const origin = request.headers.origin;
		if (Caller.of(request)?.kind === 'local' || !origin || origin === 'null') {
			return PairingRoutes.#refuse(response, 403, 'PAIRING_ORIGIN', 'A pairing binds the origin of a browser page, and this request names none');
		}
		if (!this.#pairing.allows(origin)) {
			return PairingRoutes.#refuse(response, 403, 'PAIRING_ORIGIN', `Pages of ${origin} cannot pair with this service: it is not one of its interface origins`);
		}

		const { code } = await new Body(request, { limit: PairingRoutes.LIMIT }).read();
		const redeemed = this.#pairing.redeem(code, origin);
		if (redeemed.refusal) return PairingRoutes.#refuse(response, redeemed.refusal.status, redeemed.refusal.code, redeemed.refusal.message);

		const { token, expires, pairing } = redeemed;
		const session = await this.#session();
		PairingRoutes.#answer(response, 201, { token, expires, pairing: { id: pairing.id, origin: pairing.origin, created: pairing.created }, session });
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
				.then(() => handler(request, response))
				.catch(error => (error instanceof BodyError ? PairingRoutes.#answer(response, error.status, error.body) : next(error)));

		app.post('/pairing/codes', route((request, response) => this.#code(request, response)));
		app.post('/pairing', route((request, response) => this.#pair(request, response)));
		app.delete('/pairing', route((request, response) => this.#leave(request, response)));
		app.get('/pairings', route((request, response) => this.#list(request, response)));
		app.delete('/pairings', route((request, response) => this.#revoke(request, response)));
		app.delete('/pairings/:id', route((request, response) => this.#revoke(request, response, request.params.id)));
	}
}
