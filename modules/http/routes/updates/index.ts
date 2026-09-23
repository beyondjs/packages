import { Failure } from '../failure';
import type { Request, Response, NextFunction, Application } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { Options, ResourcePath } from '@beyond-js/artifact-api';
import { Stylesheet } from '../modules/helpers';
import { Formats } from '../modules/formats';

/**
 * Delivers what a running consumer applies after a build: the update of a composed module, which
 * addresses the runtime package registered under the same identity and replaces the internal modules that
 * changed, and the stylesheet of a module, which the consumer links in place of the one it holds.
 *
 * It is provisional and deliberately outside the `/m/` namespace. The compiled-module contract is a shared
 * specification with a closed set of options and error codes, and it does not describe updates yet; this
 * route adds nothing to it and answers its own errors, so it can move into that contract, or be replaced
 * by it, without having changed what `/m/` means.
 *
 *     /u/<hash>/[<registry>/]<package>@<version>/modules/<subpath>?target=…&format=esm|system&env=development&…
 *     /u/<hash>/[<registry>/]<package>@<version>/styles/<subpath>?target=…&format=esm|system&env=development&…
 *
 * `<hash>` is the hash of the artifact, or of the stylesheet, that a `build.ended` event announced. It
 * makes every update a different URL, which a module loader and a browser need because they evaluate or
 * cache a URL once, and it lets this route refuse a notification that is no longer current instead of
 * answering it with newer code than it announced. The rest of the path and the query are read with the
 * codec of the compiled-module contract. With `format=system` the update is the `System.register` form of the
 * same patch, converted as the module route converts a module, for a consumer that loads modules through
 * SystemJS.
 */
export class UpdatesRoutes {
	static PREFIX = '/u/';

	#delivery: Delivery;
	#formats: Formats;

	constructor(delivery: Delivery, formats: Formats) {
		this.#delivery = delivery;
		this.#formats = formats;
	}

	static setup(app: Application, delivery: Delivery, formats: Formats) {
		const routes = new UpdatesRoutes(delivery, formats);
		app.get(`${UpdatesRoutes.PREFIX}*`, (request, response, next) => routes.update(request, response, next));
	}

	#refuse(response: Response, status: number, code: string, message: string, extra: object = {}) {
		Failure.send(response, status, { error: { code, message, ...extra } });
	}

	async update(request: Request, response: Response, next: NextFunction) {
		try {
			const [hash, ...rest] = request.path.slice(UpdatesRoutes.PREFIX.length).split('/');
			if (!/^[0-9a-f]{32}$/.test(hash)) return this.#refuse(response, 400, 'UPDATE_INVALID', 'The update path must start with the announced hash');

			const resource = ResourcePath.parse(`/m/${rest.join('/')}`);
			if (!['module', 'style'].includes(resource.kind)) {
				return this.#refuse(response, 400, 'UPDATE_INVALID', 'An update is the module or the stylesheet of a public module');
			}

			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1) : '';
			const options = new Options(new URLSearchParams(query));
			if (!Formats.FORMATS.includes(options.format) || options.env !== 'development' || options.min) {
				return this.#refuse(response, 400, 'UPDATE_INVALID', 'Updates are development modules: format=esm or format=system, env=development&min=false');
			}

			const { name, version, subpath } = resource.identity;
			if (resource.kind === 'style') return this.#styles(request, response, { name, version, subpath }, options, hash);

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

			const answered = this.#formats.code(code, options.format, `${hash}:patch`);
			response.set('Cache-Control', 'no-store').type('application/javascript; charset=utf-8');
			response.status(200).send(Buffer.from(answered, 'utf-8'));
		} catch (error) {
			// A path or an option that the codec of the contract rejects is answered by the error handler of the routes
			next(error);
		}
	}

	/**
	 * The stylesheet of a module at the announced hash of that stylesheet
	 */
	async #styles(request: Request, response: Response, identity: { name: string; version: string; subpath: string }, options: Options, hash: string) {
		const { styles, failure } = await this.#delivery.resources.styles(identity, options.conditions);
		if (failure) {
			const { code, message, diagnostics } = failure;
			return this.#refuse(response, code === 'BUILD_FAILED' ? 409 : 404, code, message, { diagnostics });
		}

		if (styles.hash !== hash) {
			const message = `Stylesheet "${hash}" of "${identity.name}@${identity.version}${identity.subpath.replace(/^\./, '')}" is no longer current`;
			return this.#refuse(response, 409, 'UPDATE_SUPERSEDED', message, { current: styles.hash });
		}

		response.set('Cache-Control', 'no-store').type('text/css; charset=utf-8');
		response.status(200).send(Buffer.from(Stylesheet.text(styles, options.sourcemap === 'inline'), 'utf-8'));
	}
}
