import type { Request, Response, NextFunction, Application } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, ModulePath, Options } from '@beyond-js/artifact-api';
import { Tag } from './helpers';

/**
 * The compiled-module routes of the shared contract, answered with the artifacts that Packages builds.
 *
 * Paths and options are read with the codec of `@beyond-js/artifact-api`, the one implementation of the
 * grammar, and one handler serves every spelling of it. This adapter delivers what the development pipeline
 * produces: unminified development ES modules, with an inline source map or none. Any other combination is
 * rejected as OPTION_UNSUPPORTED instead of being answered with output that is not what was asked for, and
 * no companion resource (external map, declarations, styles) is advertised because none is served.
 */
export class ModulesRoutes {
	#delivery: Delivery;

	constructor(delivery: Delivery) {
		this.#delivery = delivery;
	}

	static setup(app: Application, delivery: Delivery) {
		const routes = new ModulesRoutes(delivery);
		app.get('/m/*', (request, response, next) => routes.module(request, response, next));
	}

	/**
	 * The options this adapter can honor
	 */
	#supported(options: Options): void {
		const unsupported = (option: string, value: unknown, hint: string) => {
			throw new ContractError('OPTION_UNSUPPORTED', `This service does not produce "${option}=${value}". ${hint}`);
		};
		const explicit = 'Request development output explicitly: env=development&min=false&sourcemap=inline';

		options.format !== 'esm' && unsupported('format', options.format, 'It delivers ES modules: format=esm');
		options.env !== 'development' && unsupported('env', options.env, explicit);
		options.min && unsupported('min', options.min, explicit);
		options.sourcemap === 'external' && unsupported('sourcemap', 'external', explicit);
		options.types && unsupported('types', true, 'Declarations are not served');
		options.css && unsupported('css', true, 'Styles are not served');
	}

	async module(request: Request, response: Response, next: NextFunction) {
		try {
			const identity = ModulePath.parse(request.path);
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1) : '';
			const options = new Options(new URLSearchParams(query));
			this.#supported(options);

			if (identity.registry !== 'npm') {
				const message = `Registry "${identity.registry}" is not served: a development service delivers workspace packages`;
				throw new ContractError('SOURCE_UNSUPPORTED', message);
			}

			const { name, version, subpath } = identity;
			const { delivered, failure } = await this.#delivery.module({ name, version, subpath }, options.conditions);
			if (failure) throw new ContractError(failure.code, failure.message, { diagnostics: failure.diagnostics });

			const code = delivered.code(options.sourcemap === 'inline' ? 'inline' : 'none');

			// Development output changes with the sources, so it is revalidated on every request
			const tag = new Tag(code, 'no-store');
			if (tag.current(request, response)) return;

			response.type('application/javascript; charset=utf-8');
			response.status(200).send(Buffer.from(code, 'utf-8'));
		} catch (error) {
			next(error);
		}
	}
}
