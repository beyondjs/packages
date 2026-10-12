import { Body, BodyError } from '../body.mjs';
import { OperationError } from './error.mjs';

/**
 * The HTTP mapping of `beyond-dev-operations/1`, the long operations of the service:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `GET /operations?kind=` | `200 {protocol, operations}`: the newest first, without results |
 * | `GET /operations/:id` | `200 {operation}`; `404 OPERATION_NOT_FOUND` |
 * | `POST /operations/:id/cancel` | `202 {operation}`; `409 OPERATION_ENDED`, `409 OPERATION_NOT_CANCELLABLE` |
 *
 * Operations are created by the routes of the features that start them, which answer `202 {operation}` with the record
 * (`Location: /operations/<id>`). The routes are reached only by the service's own clients (a paired page, a local tool
 * with the credential), as every route of the API listener that is not a compiled module. Every answer is `no-store`.
 */
export class OperationRoutes {
	static LIMIT = 1024;

	#operations;

	/**
	 * @param {import('./operations.mjs').Operations} operations
	 */
	constructor(operations) {
		this.#operations = operations;
	}

	static answer(response, status, body) {
		response.status(status).set('cache-control', 'no-store');
		body === undefined ? response.end() : response.json(body);
	}

	/**
	 * A route handler that answers the refusals of operations and bodies in the envelope of the service
	 *
	 * @param {(request: object, response: object) => Promise<unknown> | unknown} handler
	 */
	static route(handler) {
		return (request, response, next) =>
			Promise.resolve()
				.then(() => handler(request, response))
				.catch(error => {
					if (error instanceof OperationError || error instanceof BodyError) return OperationRoutes.answer(response, error.status, error.body);
					next(error);
				});
	}

	/**
	 * Answers an operation a feature started: `202` with its record and where to follow it
	 *
	 * @param {object} response
	 * @param {{operation: object, created: boolean}} started
	 */
	static started(response, { operation, created }) {
		response.set('location', `/operations/${operation.id}`);
		OperationRoutes.answer(response, created ? 202 : 200, { operation });
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const route = OperationRoutes.route;
		app.get('/operations', route(async (request, response) => {
			const kind = typeof request.query.kind === 'string' ? request.query.kind : void 0;
			OperationRoutes.answer(response, 200, { protocol: 'beyond-dev-operations/1', operations: await this.#operations.list({ kind }) });
		}));
		app.get('/operations/:id', route(async (request, response) => {
			OperationRoutes.answer(response, 200, { operation: await this.#operations.get(request.params.id) });
		}));
		app.post('/operations/:id/cancel', route(async (request, response) => {
			await new Body(request, { limit: OperationRoutes.LIMIT, empty: true }).read();
			OperationRoutes.answer(response, 202, { operation: await this.#operations.cancel(request.params.id) });
		}));
	}
}
