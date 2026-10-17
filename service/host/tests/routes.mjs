import { Body, BodyError } from '../body.mjs';
import { Caller } from '../pairing/caller.mjs';
import { TestsError } from './error.mjs';

/**
 * The HTTP mapping of test runs:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `POST /tests/runs {files?}` | `202 {run}`; `409 TESTS_RUNNING`; `422 TESTS_NOT_FOUND`; `400 TESTS_FILES_INVALID` |
 * | `GET /tests/runs` | `200 {runs}`, the newest first |
 * | `GET /tests/runs/:id` | `200 {run}`; `404 TESTS_RUN_NOT_FOUND` |
 * | `POST /tests/runs/:id/cancel` | `202 {run}`; `409 TESTS_RUN_ENDED` |
 *
 * Starting and cancelling need `launch.run`, as launching does; reading needs `files.read`, since results name the
 * sources. Bodies are JSON only. Every answer is `no-store`.
 */
export class TestsRoutes {
	static LIMIT = 65536;

	#runs;

	/**
	 * @param {import('./runs.mjs').Runs} runs
	 */
	constructor(runs) {
		this.#runs = runs;
	}

	static #answer(response, status, body) {
		response.status(status).set('cache-control', 'no-store').json(body);
	}

	static #route(capability, handler) {
		return (request, response, next) =>
			Promise.resolve()
				.then(() => {
					const refusal = Caller.of(request)?.refusal(capability);
					if (refusal) return TestsRoutes.#answer(response, refusal.status, { error: { code: refusal.code, message: refusal.message } });
					return handler(request, response);
				})
				.catch(error => {
					if (error instanceof TestsError || error instanceof BodyError) return TestsRoutes.#answer(response, error.status, error.body);
					next(error);
				});
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const route = TestsRoutes.#route;
		app.post('/tests/runs', route('launch.run', async (request, response) => {
			const body = await new Body(request, { limit: TestsRoutes.LIMIT, empty: true }).read();
			const run = this.#runs.create(body?.files);
			response.set('location', `/tests/runs/${run.id}`);
			TestsRoutes.#answer(response, 202, { run: run.toJSON() });
		}));
		app.get('/tests/runs', route('files.read', (request, response) => TestsRoutes.#answer(response, 200, { runs: this.#runs.list() })));
		app.get('/tests/runs/:id', route('files.read', (request, response) => TestsRoutes.#answer(response, 200, { run: this.#runs.get(request.params.id).toJSON() })));
		app.post('/tests/runs/:id/cancel', route('launch.run', (request, response) => TestsRoutes.#answer(response, 202, { run: this.#runs.cancel(request.params.id).toJSON() })));
	}
}
