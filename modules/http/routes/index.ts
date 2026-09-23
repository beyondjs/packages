import type { Application, Request, Response, NextFunction } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, Schema } from '@beyond-js/artifact-api';
import { ModulesRoutes } from './modules';
import { Formats } from './modules/formats';
import { Sources } from './modules/sources';
import { ResolutionRoutes } from './resolution';
import { UpdatesRoutes } from './updates';
import { Failure } from './failure';

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

		ModulesRoutes.cors(app);
		if (!delivery) return;

		const sources = new Sources(delivery);
		const formats = new Formats();
		ModulesRoutes.setup(app, delivery, sources, formats);
		ResolutionRoutes.setup(app, delivery, sources);

		// Provisional: the updates of composed modules, outside the namespace of the compiled-module contract
		UpdatesRoutes.setup(app, delivery, formats);
	}

	/**
	 * Answers contract errors with the JSON body of the contract, `no-store` and without an `ETag`, which the
	 * contract defines for artifact answers only. It is mounted after every route, the ones of the caller
	 * included, so all of them fail in one shape: a path no route answers is the service-level `NOT_FOUND`, and a
	 * failure that is not a code of the contract its service-level code (`INTERNAL` keeps the message, which a
	 * local development service shows to whoever runs it).
	 */
	static errors(app: Application) {
		app.use((request: Request, response: Response, next: NextFunction) => next(new ContractError('NOT_FOUND', `This service does not serve "${request.path}"`)));
		app.use((error: Error, request: Request, response: Response, next: NextFunction) => {
			if (response.headersSent) return next(error);

			const known = error instanceof ContractError;
			const status = (<{ status?: number }>error).status;
			const reported = known ? error : status ? ContractError.of(error) : new ContractError('INTERNAL', error.message);
			Failure.send(response, reported.status, reported.body);
		});
	}
}

/**
 * The file of the OpenAPI document that describes these routes, located from the installed contract package
 */
export /*bundle*/ async function specs() {
	return Schema.path;
}
