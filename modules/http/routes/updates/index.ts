import { Failure } from '../failure';
import type { Request, Response, NextFunction, Application } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ModulePath, Options } from '@beyond-js/artifact-api';

/**
 * Delivers the update of a composed module that a runtime already loaded: the code that addresses the
 * runtime package registered under the same identity and replaces the internal modules that changed.
 *
 * It is provisional and deliberately outside the `/m/` namespace. The compiled-module contract is a shared
 * specification with a closed set of options and error codes, and it does not describe updates yet; this
 * route adds nothing to it and answers its own errors, so it can move into that contract, or be replaced
 * by it, without having changed what `/m/` means.
 *
 *     /u/<hash>/[<registry>/]<package>@<version>/modules/<subpath>?target=…&format=esm&env=development&…
 *
 * `<hash>` is the hash of the artifact that a `build.ended` event announced. It makes every update a
 * different URL, which a module loader needs because it evaluates a URL once, and it lets this route refuse
 * a notification that is no longer current instead of answering it with newer code than it announced. The
 * rest of the path and the query are read with the codec of the compiled-module contract.
 */
export class UpdatesRoutes {
	static PREFIX = '/u/';

	#delivery: Delivery;

	constructor(delivery: Delivery) {
		this.#delivery = delivery;
	}

	static setup(app: Application, delivery: Delivery) {
		const routes = new UpdatesRoutes(delivery);
		app.get(`${UpdatesRoutes.PREFIX}*`, (request, response, next) => routes.update(request, response, next));
	}

	#refuse(response: Response, status: number, code: string, message: string, extra: object = {}) {
		Failure.send(response, status, { error: { code, message, ...extra } });
	}

	async update(request: Request, response: Response, next: NextFunction) {
		try {
			const [hash, ...rest] = request.path.slice(UpdatesRoutes.PREFIX.length).split('/');
			if (!/^[0-9a-f]{32}$/.test(hash)) return this.#refuse(response, 400, 'UPDATE_INVALID', 'The update path must start with the announced artifact hash');

			const identity = ModulePath.parse(`/m/${rest.join('/')}`);
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1) : '';
			const options = new Options(new URLSearchParams(query));
			if (options.format !== 'esm' || options.env !== 'development' || options.min) {
				return this.#refuse(response, 400, 'UPDATE_INVALID', 'Updates are development ES modules: format=esm&env=development&min=false');
			}

			const { name, version, subpath } = identity;
			const { delivered, failure } = await this.#delivery.module({ name, version, subpath }, options.conditions);
			if (failure) {
				const { code, message, diagnostics } = failure;
				return this.#refuse(response, code === 'BUILD_FAILED' ? 409 : 404, code, message, { diagnostics });
			}

			if (delivered.hash !== hash) {
				const message = `Update "${hash}" of "${delivered.vspecifier}" is no longer current`;
				return this.#refuse(response, 409, 'UPDATE_SUPERSEDED', message, { current: delivered.hash });
			}

			const code = delivered.patch();
			if (code === void 0) {
				const message = `Module "${delivered.vspecifier}" is not composed at runtime, so it has no update to apply: it is reloaded`;
				return this.#refuse(response, 404, 'UPDATE_NOT_APPLICABLE', message);
			}

			response.set('Cache-Control', 'no-store').type('application/javascript; charset=utf-8');
			response.status(200).send(Buffer.from(code, 'utf-8'));
		} catch (error) {
			// A path or an option that the codec of the contract rejects is answered by the error handler of the routes
			next(error);
		}
	}
}
