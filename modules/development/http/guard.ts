import type { Application, NextFunction, Request, Response } from 'express';
import type { Access } from '../access';
import { DevelopmentError } from '../error';

/**
 * A route of the hosting service and the capability it needs: for every method, or for the methods listed
 */
type Entry = [path: RegExp, capability: string, methods?: string[]];

/**
 * Delegated access for the routes the hosting service mounts itself: the session description, state,
 * selection, the installation of the workspace, attachments, the resolution documents, compiled modules and
 * their updates. In local mode it lets everything through.
 *
 * A path that does two things needs a capability per method: reading the installation is inspection, and running
 * one writes the committed lock and the state under `.beyond` of the working copy and asks registries, which is a
 * write. A method an entry does not list falls to the next entry of the same path, the strictest last.
 *
 * The routes of the service ignore the case of a path and an ending slash, as Express routes by default, so a path
 * is matched as they read it: `/Installation` and `/installation/` are `/installation`, and `/M/…` is `/m/…`.
 */
export class Guard {
	static CAPABILITIES: Entry[] = [
		[/^\/session$/, 'session.read'],
		[/^\/(state|selection)$/, 'inspect.read'],
		[/^\/installation$/, 'inspect.read', ['GET', 'HEAD']],
		[/^\/installation$/, 'files.write'],
		[/^\/(resolution|importmap)\.json$/, 'artifacts.read'],
		[/^\/attach$/, 'events.subscribe'],
		[/^\/m\//, 'artifacts.read'],
		[/^\/u\//, 'artifacts.read'],
		[/^\/$/, 'session.read']
	];

	#access: Access;

	constructor(access: Access) {
		this.#access = access;
	}

	/**
	 * A path as the routes of the service read it: in lower case, without an ending slash (the root stays `/`)
	 */
	static #normalized(path: string): string {
		return path.toLowerCase().replace(/\/+$/, '') || '/';
	}

	/**
	 * The capability a request needs, or undefined for a route the hosting service does not mount
	 */
	static capability(request: Request): string | undefined {
		const path = Guard.#normalized(request.path);
		const entry = Guard.CAPABILITIES.find(([pattern, , methods]) => pattern.test(path) && (!methods || methods.includes(request.method)));
		return entry?.[1];
	}

	setup(app: Application) {
		app.use((request: Request, response: Response, next: NextFunction) => {
			const capability = Guard.capability(request);
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
