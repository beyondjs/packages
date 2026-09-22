import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Files } from '../files';
import type { Builds } from '../builds';
import type { Access } from '../access';
import type { Declarations } from '../declarations';
import { Revision } from '../revision';
import { DevelopmentError } from '../error';
import { Mutations } from '../mutations';
import { Stream } from './stream';

/**
 * The HTTP mapping of the development contract. Standard preconditions carry the expected revision:
 * `If-None-Match: *` creates, `If-Match: "<revision>"` edits or deletes, and a write without either is refused.
 */
export class Routes {
	#files: Files;
	#builds: Builds;
	#access: Access;
	#declarations: Declarations;

	#stream: Stream;
	get stream() {
		return this.#stream;
	}

	constructor(files: Files, builds: Builds, access: Access, declarations: Declarations) {
		this.#files = files;
		this.#builds = builds;
		this.#access = access;
		this.#declarations = declarations;
		this.#stream = new Stream(files.log, access);
	}

	#path(request: Request): string {
		// Express has decoded the wildcard; segments were percent-encoded one by one by the client
		return request.params[0];
	}

	async #body(request: Request, limit: number): Promise<Buffer> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			if ((size += chunk.length) > limit) throw new DevelopmentError('FILE_TOO_LARGE', `Bodies are limited to ${limit} bytes`, 413);
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}

	#actor(request: Request, capability: string) {
		const claims = this.#access.require(request, capability);
		return claims && { sub: claims.sub, kind: claims.act?.kind ?? 'user', ...(claims.act?.task ? { task: claims.act.task } : {}) };
	}

	setup(app: Application) {
		const route = (handler: (request: Request, response: Response) => unknown): RequestHandler =>
			(request: Request, response: Response, next: NextFunction) => Promise.resolve().then(() => handler(request, response)).catch(next);
		const result = (response: Response, outcome: { outcome: string }) => response.status(outcome.outcome === 'conflict' ? 409 : 200).json(outcome);

		app.get('/files/tree', route(async (request, response) => {
			this.#access.require(request, 'files.read');
			const { path, scan } = request.query as Record<string, string>;
			response.set('cache-control', 'no-store').json(await this.#files.tree({ path: path || undefined, scan: scan === 'true' || scan === '1' }));
		}));

		app.get('/files/content/*', route(async (request, response) => {
			this.#access.require(request, 'files.read');
			const { bytes, revision, cursor } = await this.#files.read(this.#path(request));
			response.set({ etag: `"${revision}"`, 'beyond-cursor': cursor, 'cache-control': 'no-store' });
			if (Revision.expected(request.headers['if-none-match'], false) === revision) return response.status(304).end();
			response.type('application/octet-stream').send(bytes);
		}));

		app.put('/files/content/*', route(async (request, response) => {
			const actor = this.#actor(request, 'files.write');
			const expected = Revision.expected(request.headers['if-none-match'], true) ?? Revision.expected(request.headers['if-match'], false);
			const bytes = await this.#body(request, Mutations.LIMIT);
			result(response, await this.#files.mutate({ operation: 'write', path: this.#path(request), expected }, actor, bytes));
		}));

		app.delete('/files/content/*', route(async (request, response) => {
			const actor = this.#actor(request, 'files.write');
			const expected = Revision.expected(request.headers['if-match'], false);
			result(response, await this.#files.mutate({ operation: 'delete', path: this.#path(request), expected }, actor));
		}));

		app.post('/files/operations', route(async (request, response) => {
			const actor = this.#actor(request, 'files.write');
			const body = JSON.parse((await this.#body(request, 4 * Mutations.LIMIT)).toString('utf8') || '{}');
			response.json(await this.#files.batch(body.mutations, actor));
		}));

		app.get('/events', route((request, response) => this.#stream.handle(request, response)));

		app.post('/builds', route((request, response) => {
			this.#access.require(request, 'build.control');
			response.status(202).json(this.#builds.start());
		}));
		app.get('/builds/:id', route((request, response) => {
			this.#access.require(request, 'inspect.read');
			response.json(this.#builds.get(request.params.id));
		}));
		app.post('/builds/:id/cancel', route((request, response) => {
			this.#access.require(request, 'build.control');
			response.json(this.#builds.cancel(request.params.id));
		}));

		app.get('/declarations/*', route(async (request, response) => {
			this.#access.require(request, 'inspect.read');
			const { code, hash, cursor } = await this.#declarations.read(this.#path(request));
			response.set({ etag: `"${hash}"`, 'beyond-cursor': cursor, 'cache-control': 'no-store' });
			// The tag is the hash of the output, not a source revision, so it is compared as sent
			const expected = request.headers['if-none-match']?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
			if (expected === hash) return response.status(304).end();
			response.type('text/plain; charset=utf-8').send(code);
		}));

		// The list is signed and ordered, so the route needs no bearer
		app.put('/access/revocations', route(async (request, response) => {
			if (this.#access.mode !== 'delegated') throw new DevelopmentError('NOT_FOUND', 'This service has no delegated access', 404);
			this.#access.revocations((await this.#body(request, 1024 * 1024)).toString('utf8'));
			response.status(204).end();
		}));

		app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
			if (!(error instanceof DevelopmentError) || response.headersSent) return next(error);
			response.status(error.status).json(error.body);
		});
	}
}
