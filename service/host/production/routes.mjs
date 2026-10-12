import { Body, BodyError } from '../body.mjs';
import { ExportError } from '../exports/error.mjs';
import { Idempotency } from '../idempotency.mjs';
import { OperationError } from '../operations/error.mjs';
import { OperationRoutes } from '../operations/routes.mjs';
import { ProductionError } from './error.mjs';

/**
 * The HTTP mapping of `beyond-production/1`:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `GET /production/packages/:member` | `200` the preflight of the package (`Preflight`) |
 * | `POST /production/packages/:member/archives` | `202 {operation}` `production.pack` |
 * | `POST /production/packages/:member/status {registry?, archive?}` | `202 {operation}` `production.status` |
 * | `POST /production/packages/:member/publish {archive, registry, access, tag?, confirm}` with `Idempotency-Key` | `202 {operation}` `production.publish` |
 * | `POST /production/exports {application, target, strategy, destination, base?, replace?}` with `Idempotency-Key` | `202 {operation}` `production.export` |
 * | `GET /production/exports`, `GET /production/exports/:id` | `200 {protocol, exports}`, `200 {export}` |
 *
 * `:member` is a member's directory relative to the root, encoded (`packages%2Fui`; the root package is `%2E`), or its
 * package name (`%40scope%2Fui`). A body is JSON (`Body`); a request that the same `Idempotency-Key` (`Idempotency`) sent
 * before answers the operation it created (`200`). A refusal answers its status and code (`ProductionError`), every answer is
 * `no-store`, and an operation is followed at `Location: /operations/<id>`. Mounted only where the feature is enabled:
 * on any other service the requests reach the routes after them, as if nothing were mounted.
 */
export class ProductionRoutes {
	static LIMIT = 16384;

	#production;
	#enabled;

	/**
	 * @param {import('./production.mjs').Production} production
	 * @param {() => boolean} enabled Whether the feature serves the request (the development extension is mounted)
	 */
	constructor(production, enabled) {
		this.#production = production;
		this.#enabled = enabled;
	}

	/**
	 * The request identifier of a request that must not be carried out twice (`Idempotency`)
	 *
	 * @param {import('express').Request} request
	 * @param {boolean} required
	 */
	static key(request, required) {
		const refuse = (code, message) => new ProductionError(code, message);
		return new Idempotency(request).key({ required, refuse, why: 'the same key answers the same operation and the work is never done twice' });
	}

	#route(handler) {
		return (request, response, next) => {
			if (!this.#enabled()) return next();
			Promise.resolve()
				.then(() => handler(request, response))
				.catch(error => {
					if (error instanceof ProductionError || error instanceof OperationError || error instanceof BodyError) return OperationRoutes.answer(response, error.status, error.body);
					if (error instanceof ExportError) return OperationRoutes.answer(response, error.status, { error: error.described });
					next(error);
				});
		};
	}

	static #body(request, empty = true) {
		return new Body(request, { limit: ProductionRoutes.LIMIT, empty }).read();
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const production = this.#production;
		const route = handler => this.#route(handler);
		app.get('/production/packages/:member', route(async (request, response) => {
			OperationRoutes.answer(response, 200, await production.preflight(request.params.member));
		}));
		app.post('/production/packages/:member/archives', route(async (request, response) => {
			await ProductionRoutes.#body(request);
			OperationRoutes.started(response, await production.pack(request.params.member, ProductionRoutes.key(request, false)));
		}));
		app.post('/production/packages/:member/status', route(async (request, response) => {
			const body = await ProductionRoutes.#body(request);
			OperationRoutes.started(response, await production.status(request.params.member, body, ProductionRoutes.key(request, false)));
		}));
		app.post('/production/packages/:member/publish', route(async (request, response) => {
			const key = ProductionRoutes.key(request, true);
			const body = await ProductionRoutes.#body(request, false);
			OperationRoutes.started(response, await production.publish(request.params.member, body, key));
		}));
		app.post('/production/exports', route(async (request, response) => {
			const key = ProductionRoutes.key(request, true);
			const body = await ProductionRoutes.#body(request, false);
			OperationRoutes.started(response, await production.export(body, key));
		}));
		app.get('/production/exports', route(async (request, response) => {
			OperationRoutes.answer(response, 200, { protocol: 'beyond-production/1', exports: await production.records.list() });
		}));
		app.get('/production/exports/:id', route(async (request, response) => {
			OperationRoutes.answer(response, 200, { export: await production.records.get(request.params.id) });
		}));
	}
}
