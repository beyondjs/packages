import { Body, BodyError } from '../body.mjs';
import { SettingsError } from './error.mjs';

/**
 * The HTTP mapping of `beyond-dev-settings/1`:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `GET /settings` | `200` the document, `ETag: "<revision>"` |
 * | `PUT /settings {values}` with `If-Match: "<revision>"` | `200 {outcome: completed, revision, document}`; `409 {outcome: conflict, revision, document}` when the file is at another revision, nothing written; `428 PRECONDITION_REQUIRED` without a revision; `403 SETTING_FIXED`; `422 SETTING_INVALID` with one diagnostic per key |
 *
 * A change is read only as `Content-Type: application/json` (`415` otherwise), so a page of another site cannot send
 * one without a preflight, and the routes are reached only by the service's own clients (a paired page, a local tool
 * with the credential) as every route of the API listener that is not a compiled module. Every answer is `no-store`.
 * A change whose answer was lost is read back with `GET /settings` before it is sent again: sent again with the
 * revision it was based on, it is a conflict once the first one was written.
 */
export class SettingsRoutes {
	/**
	 * The largest body of a change: the variables of a few targets at their limits
	 */
	static LIMIT = 1024 * 1024;

	#feature;

	/**
	 * @param {import('./index.mjs').Feature} feature
	 */
	constructor(feature) {
		this.#feature = feature;
	}

	static #answer(response, status, body) {
		response.status(status).set('cache-control', 'no-store').json(body);
	}

	/**
	 * The revision an `If-Match` header names, without its quotes; undefined for none or for `*`, which names no
	 * revision a client read
	 *
	 * @param {unknown} header
	 */
	static revision(header) {
		if (typeof header !== 'string') return;
		const value = header.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
		return value && value !== '*' ? value : void 0;
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const route = handler => (request, response, next) =>
			Promise.resolve()
				.then(() => handler(request, response))
				.catch(error => {
					if (error instanceof SettingsError || error instanceof BodyError) return SettingsRoutes.#answer(response, error.status, error.body);
					next(error);
				});

		app.get('/settings', route(async (request, response) => {
			const document = await this.#feature.document();
			response.set('etag', `"${document.revision}"`);
			SettingsRoutes.#answer(response, 200, document);
		}));

		app.put('/settings', route(async (request, response) => {
			const expected = SettingsRoutes.revision(request.headers['if-match']);
			if (!expected) {
				throw new SettingsError(428, 'PRECONDITION_REQUIRED', 'A change of the settings names the revision it was based on: If-Match: "<revision>", as GET /settings answered it');
			}
			const { values } = await new Body(request, { limit: SettingsRoutes.LIMIT }).read();
			const { outcome, document } = await this.#feature.change(values, expected);
			response.set('etag', `"${document.revision}"`);
			SettingsRoutes.#answer(response, outcome === 'conflict' ? 409 : 200, { outcome, revision: document.revision, document });
		}));
	}
}
