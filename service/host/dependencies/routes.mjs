import { Body, BodyError } from '../body.mjs';
import { Idempotency } from '../idempotency.mjs';
import { OperationError } from '../operations/error.mjs';
import { OperationRoutes } from '../operations/routes.mjs';
import { DependencyError } from './error.mjs';
import { Scope } from './scope.mjs';
import { Changes } from './changes.mjs';
import { Inventory } from './inventory.mjs';
import { Snapshot } from './snapshot.mjs';
import { PlanStore } from './store.mjs';
import { Checks } from './checks.mjs';
import { Preflight } from './preflight.mjs';
import { Plans } from './plans.mjs';
import { Applying } from './apply.mjs';

/**
 * The HTTP mapping of `beyond-dependencies/1`:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `GET /dependencies?scope=` | `200` the inventory of the scope (`workspace`, `member:<id>`, `node:<key>`); `400 SCOPE_INVALID`, `404 SCOPE_NOT_FOUND` |
 * | `POST /dependencies/checks {scope}` | `202 {operation}` of kind `dependencies.check` |
 * | `POST /dependencies/preflight` | `202 {operation}` of kind `dependencies.preflight` |
 * | `POST /dependencies/plans {changes, base}` | `202 {operation}` of kind `dependencies.plan`; `400 CHANGES_INVALID`, `BASE_REQUIRED`; `422 CHANGE_UNDECLARED`; `409 PLAN_STALE` |
 * | `GET /dependencies/plans/:plan` | `200 {plan}`; `404 PLAN_NOT_FOUND` |
 * | `POST /dependencies/plans/:plan/apply {base}` | `202 {operation}` of kind `dependencies.apply`; `400 IDEMPOTENCY_KEY_REQUIRED`; `404 PLAN_NOT_FOUND`; `422 PLAN_INVALID`; `409 PLAN_STALE` |
 *
 * A request that starts an operation may carry an `Idempotency-Key` (`Idempotency`, required to apply): the same key
 * for the same kind answers the operation it started (`200`), whatever the workspace became since. Bodies are JSON
 * (`415 CONTENT_TYPE_UNSUPPORTED` otherwise, which a page of another origin cannot send without a preflight the
 * service refuses it), at most `LIMIT` bytes, with no field but the route's own. Every answer is `no-store`. Without
 * the File API of the development extension the routes answer as if they were not mounted.
 */
export class DependencyRoutes {
	static LIMIT = 64 * 1024;

	#host;
	#operations;
	#store;
	#work;

	/**
	 * @param {{host: import('./host.mjs').Host, operations: import('../operations/operations.mjs').Operations, store:
	 * PlanStore, checks: Checks, preflight: Preflight, plans: Plans, applying: Applying}} parts
	 */
	constructor({ host, operations, store, checks, preflight, plans, applying }) {
		this.#host = host;
		this.#operations = operations;
		this.#store = store;
		this.#work = { checks, preflight, plans, applying };
	}

	static answer(response, status, body) {
		response.status(status).set('cache-control', 'no-store').json(body);
	}

	/**
	 * A handler that answers refusals in the envelope of the service, and passes on when the File API is not there
	 */
	#route(handler) {
		return (request, response, next) => {
			if (!this.#host.files) return next();
			Promise.resolve()
				.then(() => handler(request, response))
				.catch(error => {
					const known = error instanceof DependencyError || error instanceof OperationError || error instanceof BodyError;
					known ? DependencyRoutes.answer(response, error.status, error.body) : next(error);
				});
		};
	}

	/**
	 * The `Idempotency-Key` of a request (`Idempotency`), which applying a plan needs
	 */
	static #key(request, required = false) {
		const refuse = (code, message) => new DependencyError(code, message);
		return new Idempotency(request).key({ required, refuse, why: 'a repeated request never applies the plan twice' });
	}

	static async #body(request, fields, empty = false) {
		const body = await new Body(request, { limit: DependencyRoutes.LIMIT, empty }).read();
		const unknown = Object.keys(body).find(field => !fields.includes(field));
		if (unknown) throw new BodyError(400, 'BODY_INVALID', `Unknown field "${unknown}" (expected: ${fields.join(', ') || 'none'})`);
		return body;
	}

	static #base(value) {
		if (!value || typeof value !== 'object' || typeof value.lock !== 'string' || typeof value.inputs !== 'string') {
			throw new DependencyError('BASE_REQUIRED', 'The base is the {lock, inputs} the inventory answered, which a plan is made against');
		}
		return { lock: value.lock, inputs: value.inputs };
	}

	/**
	 * The operation an earlier request with this key started, when there is one
	 */
	async #known(kind, key) {
		if (!key) return;
		const found = (await this.#operations.list({ kind, limit: 500 })).find(record => record.kind === kind && record.key === key);
		return found ? { operation: await this.#operations.get(found.id), created: false } : void 0;
	}

	async #start(response, specs, work) {
		const started = (await this.#known(specs.kind, specs.key)) ?? (await this.#operations.run(specs, work));
		OperationRoutes.started(response, started);
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.get('/dependencies', this.#route(async (request, response) => {
			const scope = Scope.parse(request.query.scope);
			DependencyRoutes.answer(response, 200, new Inventory(await this.#host.snapshot()).describe(scope));
		}));

		app.post('/dependencies/checks', this.#route(async (request, response) => {
			const body = await DependencyRoutes.#body(request, ['scope'], true);
			const scope = Scope.parse(body.scope);
			const key = DependencyRoutes.#key(request);
			const known = await this.#known(Checks.KIND, key);
			if (known) return OperationRoutes.started(response, known);
			// An unknown member or node is refused before any operation exists
			new Inventory(await this.#host.snapshot()).keys(scope);
			const specs = { kind: Checks.KIND, ...(key ? { key } : {}), scope: scope.toJSON(), cancellable: true, steps: [...Checks.STEPS] };
			await this.#start(response, specs, operation => this.#work.checks.run(operation, scope));
		}));

		app.post('/dependencies/preflight', this.#route(async (request, response) => {
			await DependencyRoutes.#body(request, [], true);
			const key = DependencyRoutes.#key(request);
			const specs = { kind: Preflight.KIND, ...(key ? { key } : {}), scope: { kind: 'workspace' }, cancellable: true, steps: [...Preflight.STEPS] };
			await this.#start(response, specs, operation => this.#work.preflight.run(operation));
		}));

		app.post('/dependencies/plans', this.#route(async (request, response) => {
			const body = await DependencyRoutes.#body(request, ['changes', 'base']);
			const changes = new Changes(body.changes);
			const base = DependencyRoutes.#base(body.base);
			const key = DependencyRoutes.#key(request);
			const known = await this.#known(Plans.KIND, key);
			if (known) return OperationRoutes.started(response, known);

			const snapshot = await this.#host.snapshot();
			if (!Snapshot.same(snapshot.base, base)) throw Plans.stale(base, snapshot.base);
			changes.resolve(snapshot.importers);
			const specs = { kind: Plans.KIND, ...(key ? { key } : {}), scope: { kind: 'workspace', changes: changes.list }, cancellable: true, steps: [...Plans.STEPS] };
			await this.#start(response, specs, operation => this.#work.plans.run(operation, { changes, base }));
		}));

		app.get('/dependencies/plans/:plan', this.#route(async (request, response) => {
			DependencyRoutes.answer(response, 200, { plan: await this.#plan(request.params.plan) });
		}));

		app.post('/dependencies/plans/:plan/apply', this.#route(async (request, response) => {
			const body = await DependencyRoutes.#body(request, ['base']);
			const base = DependencyRoutes.#base(body.base);
			const key = DependencyRoutes.#key(request, true);
			const known = await this.#known(Applying.KIND, key);
			if (known) return OperationRoutes.started(response, known);

			const plan = await this.#plan(request.params.plan);
			if (!plan.valid) throw new DependencyError('PLAN_INVALID', 'The plan has errors: it cannot be applied', { diagnostics: plan.diagnostics.filter(({ severity }) => severity === 'error') });
			if (!Snapshot.same(plan.base, base)) throw Plans.stale(base, plan.base);
			const specs = { kind: Applying.KIND, key, scope: { kind: 'workspace', plan: plan.id }, cancellable: false, bound: 20 * 60 * 1000, steps: [...Applying.STEPS] };
			await this.#start(response, specs, operation => this.#work.applying.run(operation, plan));
		}));
	}

	async #plan(id) {
		const plan = PlanStore.valid(id) ? await this.#store.read(id) : void 0;
		if (!plan) throw new DependencyError('PLAN_NOT_FOUND', `There is no plan "${String(id).slice(0, 80)}"`);
		return plan;
	}
}
