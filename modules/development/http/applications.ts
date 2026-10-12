import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Access } from '../access';
import type { IActor } from '../mutations';
import type { ICondition, IWritten } from '../applications/writer';
import type { IApplicationsCatalog, IResolvedTarget } from '../applications/types';
import { DevelopmentError } from '../error';
import { Revision } from '../revision';

/**
 * What the routes of the catalog work with
 */
export interface IApplicationsService {
	refresh(): Promise<IApplicationsCatalog>;
	resolve(application: string, target: string): Promise<IResolvedTarget>;
	put(application: string, value: unknown, condition: ICondition, actor?: IActor): Promise<IWritten>;
	remove(application: string, expected: string, actor?: IActor): Promise<IWritten>;
}

/**
 * The HTTP mapping of the catalog of applications (`beyond-applications/1`).
 *
 * Reading the catalog and resolving a target need `inspect.read`; creating, replacing and removing an application
 * need `files.write`, since they write the document that declares it through the File API. A write states the
 * revision of that document with `If-Match: "<revision>"`, or `If-None-Match: *` for an application that does not
 * exist yet (`428 PRECONDITION_REQUIRED` with neither), and is answered `409` with the current revision when the
 * document changed meanwhile. Its body is parsed only when it is sent as `Content-Type: application/json`
 * (`415 CONTENT_TYPE_UNSUPPORTED` otherwise), because a page of another site can send a text body to any origin
 * without asking first.
 */
export class ApplicationsRoutes {
	static LIMIT = 256 * 1024;

	#applications: IApplicationsService;
	#access: Access;

	constructor(applications: IApplicationsService, access: Access) {
		this.#applications = applications;
		this.#access = access;
	}

	#actor(request: Request): IActor | undefined {
		const claims = this.#access.require(request, 'files.write');
		return claims && { sub: claims.sub, kind: claims.act?.kind ?? 'user', ...(claims.act?.task ? { task: claims.act.task } : {}) };
	}

	static #json(request: Request) {
		const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
		if (type === 'application/json') return;
		const message = `An application is sent as Content-Type: application/json (it was ${type ? `"${type}"` : 'sent without one'})`;
		throw new DevelopmentError('CONTENT_TYPE_UNSUPPORTED', message, 415);
	}

	/**
	 * What a write states about the document: `If-None-Match: *` that the application does not exist yet, `If-Match`
	 * the revision its writer read
	 */
	static #condition(request: Request): ICondition {
		if (Revision.expected(request.headers['if-none-match'], true) === Revision.ABSENT) return { absent: true };
		const expected = Revision.expected(request.headers['if-match'], false);
		if (expected) return { expected };
		const message = 'State the revision of the declaration with If-Match, or create an application with If-None-Match: *';
		throw new DevelopmentError('PRECONDITION_REQUIRED', message, 428);
	}

	static async #body(request: Request): Promise<unknown> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			if ((size += chunk.length) > ApplicationsRoutes.LIMIT) {
				throw new DevelopmentError('BODY_TOO_LARGE', `An application is limited to ${ApplicationsRoutes.LIMIT} bytes`, 413);
			}
			chunks.push(chunk);
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString('utf8'));
		} catch {
			throw new DevelopmentError('BODY_INVALID', 'The body of an application is a JSON document', 400);
		}
	}

	static #written(response: Response, written: IWritten) {
		response.status(written.outcome === 'conflict' ? 409 : 200).set('cache-control', 'no-store').json(written);
	}

	setup(app: Application) {
		const route = (handler: (request: Request, response: Response) => unknown): RequestHandler =>
			(request: Request, response: Response, next: NextFunction) => Promise.resolve().then(() => handler(request, response)).catch(next);

		app.get('/applications', route(async (request, response) => {
			this.#access.require(request, 'inspect.read');
			response.set('cache-control', 'no-store').json(await this.#applications.refresh());
		}));

		app.get('/applications/:application/targets/:target', route(async (request, response) => {
			this.#access.require(request, 'inspect.read');
			const { application, target } = request.params;
			response.set('cache-control', 'no-store').json(await this.#applications.resolve(application, target));
		}));

		app.put('/applications/:application', route(async (request, response) => {
			const actor = this.#actor(request);
			ApplicationsRoutes.#json(request);
			const condition = ApplicationsRoutes.#condition(request);
			const value = await ApplicationsRoutes.#body(request);
			ApplicationsRoutes.#written(response, await this.#applications.put(request.params.application, value, condition, actor));
		}));

		app.delete('/applications/:application', route(async (request, response) => {
			const actor = this.#actor(request);
			const expected = Revision.expected(request.headers['if-match'], false);
			if (!expected) throw new DevelopmentError('PRECONDITION_REQUIRED', 'State the revision of the declaration with If-Match', 428);
			ApplicationsRoutes.#written(response, await this.#applications.remove(request.params.application, expected, actor));
		}));
	}
}
