import type { Application, NextFunction, Request, Response } from 'express';
import type { Access } from '../access';
import { DevelopmentError } from '../error';

/**
 * Delegated access for the routes the hosting service mounts itself: the session description, state,
 * selection, attachments and compiled modules. In local mode it lets everything through.
 */
export class Guard {
	static CAPABILITIES: [RegExp, string][] = [
		[/^\/session$/, 'session.read'],
		[/^\/(state|selection)$/, 'inspect.read'],
		[/^\/attach$/, 'events.subscribe'],
		[/^\/m\//, 'artifacts.read'],
		[/^\/$/, 'session.read']
	];

	#access: Access;

	constructor(access: Access) {
		this.#access = access;
	}

	setup(app: Application) {
		app.use((request: Request, response: Response, next: NextFunction) => {
			const capability = Guard.CAPABILITIES.find(([pattern]) => pattern.test(request.path))?.[1];
			if (!capability) return next();
			try {
				this.#access.require(request, capability);
				next();
			} catch (error) {
				if (!(error instanceof DevelopmentError)) return next(error);
				response.status(error.status).json(error.body);
			}
		});
	}
}
