import type { Application, Request, Response, NextFunction } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, Schema } from '@beyond-js/artifact-api';
import { ModulesRoutes } from './modules';
import { UpdatesRoutes } from './updates';

/**
 * The HTTP building blocks of the compiled-module API, mounted on an Express application that the caller
 * owns: this module starts no server, so a development service, a test or a CDN adapter decides the port,
 * the lifecycle and the access policy.
 */
export /*bundle*/ class Routes {
	/**
	 * @param app The application to mount the routes on
	 * @param delivery What answers the module requests. Without it only the identity route is mounted,
	 * which is the case of a host that has no workspace to deliver.
	 */
	static setup(app: Application, delivery?: Delivery) {
		app.get('/', (request: Request, response: Response) =>
			response.json({ service: '@beyond-js/packages/http/routes', contract: Schema.version })
		);

		delivery && ModulesRoutes.setup(app, delivery);

		// Provisional: the updates of composed modules, outside the namespace of the compiled-module contract
		delivery && UpdatesRoutes.setup(app, delivery);
	}

	/**
	 * Answers contract errors with the JSON body of the contract. It is mounted after every route, the ones
	 * of the caller included, so all of them fail in one shape.
	 */
	static errors(app: Application) {
		app.use((error: Error, request: Request, response: Response, next: NextFunction) => {
			if (response.headersSent) return next(error);

			const known = error instanceof ContractError;
			const reported = known ? error : new ContractError('INTERNAL_ERROR', error.message, { status: 500 });
			response.status(reported.status).json(reported.body);
		});
	}
}

/**
 * The file of the OpenAPI document that describes these routes, located from the installed contract package
 */
export /*bundle*/ async function specs() {
	return Schema.path;
}
