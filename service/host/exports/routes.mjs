import { Body, BodyError } from '../body.mjs';
import { ExportError } from './error.mjs';

/**
 * The HTTP mapping of `beyond-dev-exports/1`:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `POST /exports {packages: [path]}` | `201 {export}`; `400 EXPORT_PACKAGE_INVALID` |
 * | `GET /exports`, `GET /exports/:id` | `200 {exports}`, `200 {export}`; `404 EXPORT_NOT_FOUND` |
 * | `POST /exports/:id/transfer {capture: {id}, grants: [{path, upload, token, expires}]}` | `202 {export}`; `403 EXPORT_DESTINATION`, `409 EXPORT_CONFLICT` |
 * | `DELETE /exports/:id` | `204`: a transfer under way is cancelled and the archives are removed |
 *
 * The routes exist on a service that pairs, where a browser reaches them only with a pairing, and their bodies are
 * read as `Content-Type: application/json` only (`415` otherwise), so a page of another site cannot have one created
 * or transferred. Every answer is `no-store`.
 */
export class ExportRoutes {
	static LIMIT = 65536;

	#exports;

	/**
	 * @param {import('./exports.mjs').Exports} exports
	 */
	constructor(exports) {
		this.#exports = exports;
	}

	static #answer(response, status, body) {
		response.status(status).set('cache-control', 'no-store');
		body === undefined ? response.end() : response.json(body);
	}

	/**
	 * Mounts the routes; they answer their own refusals in the envelope of the service
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const route = handler => (request, response, next) =>
			Promise.resolve()
				.then(() => handler(request, response))
				.catch(error => {
					if (error instanceof ExportError) return ExportRoutes.#answer(response, error.status, { error: error.described });
					if (error instanceof BodyError) return ExportRoutes.#answer(response, error.status, error.body);
					next(error);
				});
		const body = request => new Body(request, { limit: ExportRoutes.LIMIT }).read();

		app.post('/exports', route(async (request, response) => {
			const { packages } = await body(request);
			ExportRoutes.#answer(response, 201, { export: await this.#exports.create(packages) });
		}));
		app.get('/exports', route(async (request, response) => ExportRoutes.#answer(response, 200, { exports: await this.#exports.list() })));
		app.get('/exports/:id', route(async (request, response) => ExportRoutes.#answer(response, 200, { export: await this.#exports.get(request.params.id) })));
		app.post('/exports/:id/transfer', route(async (request, response) => {
			const transfer = await body(request);
			ExportRoutes.#answer(response, 202, { export: await this.#exports.transfer(request.params.id, transfer) });
		}));
		app.delete('/exports/:id', route(async (request, response) => {
			const removed = await this.#exports.remove(request.params.id);
			if (!removed) throw new ExportError('EXPORT_NOT_FOUND', `There is no export "${request.params.id}"`);
			ExportRoutes.#answer(response, 204);
		}));
	}
}
