import { Body, BodyError } from '../body.mjs';
import { Idempotency } from '../idempotency.mjs';
import { Caller } from '../pairing/caller.mjs';
import { LaunchError } from './error.mjs';

/**
 * The HTTP mapping of `beyond-launches/1`:
 *
 * | Route | Answer |
 * | --- | --- |
 * | `GET /launches` | `200 {protocol, launches, listeners}`, the launches newest first, and the declared targets whose port something listens on (`{application, target, port, address, launch?}`) |
 * | `POST /launches {application, target}` with `Idempotency-Key` | `202 {launch}` (`Location: /launches/<id>`); the same key answers the same launch (`200`); `409 LAUNCH_RUNNING`; `422 TARGET_NOT_LAUNCHABLE`; `404 APPLICATION_NOT_FOUND`, `TARGET_NOT_FOUND` |
 * | `GET /launches/:id` | `200 {launch}`; `404 LAUNCH_NOT_FOUND` |
 * | `POST /launches/:id/stop` | `202 {launch}`; `409 LAUNCH_ENDED` |
 * | `GET /launches/:id/output?after=<seq>` | `200 {lines, next, dropped}` |
 *
 * Bodies are JSON only (`Body`): a page of another origin cannot send one without asking first. On a service that
 * pairs, the policy already admitted only paired pages and local tools; a caller without the capability of a route
 * (`launch.run` to start or stop, `inspect.read` to read) is refused as the policy says. Every answer is `no-store`.
 */
export class LaunchRoutes {
	static PROTOCOL = 'beyond-launches/1';

	/**
	 * The largest body of a request, in bytes
	 */
	static LIMIT = 4096;

	static #ID = /^lch_[0-9a-f]{24}$/;
	static #APPLICATION = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
	static #TARGET = /^[a-z][a-z0-9-]{0,31}$/;

	#launches;

	/**
	 * @param {import('./launches.mjs').Launches} launches
	 */
	constructor(launches) {
		this.#launches = launches;
	}

	static #answer(response, status, body) {
		response.status(status).set('cache-control', 'no-store').json(body);
	}

	/**
	 * A route handler that checks the capability of its caller and answers refusals in the envelope of the service
	 */
	static #route(capability, handler) {
		return (request, response, next) =>
			Promise.resolve()
				.then(() => {
					const refusal = Caller.of(request)?.refusal(capability);
					if (refusal) return LaunchRoutes.#answer(response, refusal.status, { error: { code: refusal.code, message: refusal.message } });
					return handler(request, response);
				})
				.catch(error => {
					if (error instanceof LaunchError || error instanceof BodyError) return LaunchRoutes.#answer(response, error.status, error.body);
					next(error);
				});
	}

	/**
	 * The launch an address names; an identifier of another form names none
	 */
	#launch(id) {
		if (!LaunchRoutes.#ID.test(id)) throw new LaunchError('LAUNCH_NOT_FOUND', `This development service has no launch "${id}"`);
		return this.#launches.get(id);
	}

	/**
	 * The request identifier of a launch request (`Idempotency`)
	 */
	static #key(request) {
		const refuse = (code, message) => new LaunchError(code, message);
		return new Idempotency(request).key({ required: true, refuse, why: 'repeating it never starts a second process' });
	}

	/**
	 * The target a launch request names
	 */
	static #named(body) {
		const { application, target } = body;
		const valid = typeof application === 'string' && LaunchRoutes.#APPLICATION.test(application) && typeof target === 'string' && LaunchRoutes.#TARGET.test(target);
		if (!valid) throw new LaunchError('BODY_INVALID', 'A launch request names a declared target: {"application": "<application>", "target": "<target>"}');
		return { application, target };
	}

	/**
	 * The origin a request reached: the address and port of the listener it arrived on, which is the API listener's,
	 * since the preview listener serves no launch route
	 */
	static #reached(request) {
		const { localAddress = '127.0.0.1', localPort } = request.socket;
		const address = localAddress.replace(/^::ffff:/, '');
		const host = ['0.0.0.0', '::'].includes(address) ? '127.0.0.1' : address.includes(':') ? `[${address}]` : address;
		return `http://${host}:${localPort}`;
	}

	/**
	 * The number after which output is read
	 */
	static #after(query) {
		const { after = '0' } = query;
		if (typeof after !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(after)) throw new LaunchError('OPTION_INVALID', 'after is the number of the last line read, 0 or more');
		return Number(after);
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		const route = LaunchRoutes.#route;
		app.get('/launches', route('inspect.read', async (request, response) => {
			const listeners = await this.#launches.listeners();
			LaunchRoutes.#answer(response, 200, { protocol: LaunchRoutes.PROTOCOL, launches: this.#launches.list(), listeners });
		}));
		app.post('/launches', route('launch.run', async (request, response) => {
			const key = LaunchRoutes.#key(request);
			const named = LaunchRoutes.#named(await new Body(request, { limit: LaunchRoutes.LIMIT }).read());
			const { launch, created } = await this.#launches.create(named, key, LaunchRoutes.#reached(request));
			response.set('location', `/launches/${launch.id}`);
			LaunchRoutes.#answer(response, created ? 202 : 200, { launch: launch.toJSON() });
		}));
		app.get('/launches/:id', route('inspect.read', (request, response) => {
			LaunchRoutes.#answer(response, 200, { launch: this.#launch(request.params.id).toJSON() });
		}));
		app.post('/launches/:id/stop', route('launch.run', async (request, response) => {
			await new Body(request, { limit: LaunchRoutes.LIMIT, empty: true }).read();
			this.#launch(request.params.id);
			LaunchRoutes.#answer(response, 202, { launch: this.#launches.stop(request.params.id).toJSON() });
		}));
		app.get('/launches/:id/output', route('inspect.read', (request, response) => {
			const after = LaunchRoutes.#after(request.query);
			LaunchRoutes.#answer(response, 200, this.#launch(request.params.id).output.read(after));
		}));
	}
}
