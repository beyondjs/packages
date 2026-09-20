import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Access } from '../access';
import type { Selection } from '../selection';
import type { Preview } from '../preview';
import { DevelopmentError } from '../error';

/**
 * The HTTP mapping of the development selection and of the preview entry.
 *
 * The selection is read with `inspect.read` and replaced with `build.control`: it decides what this
 * environment builds and serves for development, it is not a source write, and a viewer must not change it.
 * The preview needs `artifacts.read`, the capability of whoever loads compiled modules.
 */
export class PreviewRoutes {
	static LIMIT = 256 * 1024;

	#selection: Selection;
	#preview: Preview;
	#access: Access;

	constructor(selection: Selection, preview: Preview, access: Access) {
		this.#selection = selection;
		this.#preview = preview;
		this.#access = access;
	}

	async #body(request: Request): Promise<unknown> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			if ((size += chunk.length) > PreviewRoutes.LIMIT) throw new DevelopmentError('SELECTION_INVALID', 'The selection is too large', 413);
			chunks.push(chunk);
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString('utf8'));
		} catch {
			throw new DevelopmentError('SELECTION_INVALID', 'The selection must be a JSON document', 400);
		}
	}

	#entry(request: Request): string | undefined {
		const { entry } = request.query;
		return typeof entry === 'string' && entry ? entry : void 0;
	}

	setup(app: Application) {
		const route = (handler: (request: Request, response: Response) => unknown): RequestHandler =>
			(request: Request, response: Response, next: NextFunction) => Promise.resolve().then(() => handler(request, response)).catch(next);

		app.get('/development/selection', route(async (request, response) => {
			this.#access.require(request, 'inspect.read');
			response.set('cache-control', 'no-store').json(await this.#selection.read());
		}));
		app.put('/development/selection', route(async (request, response) => {
			this.#access.require(request, 'build.control');
			response.set('cache-control', 'no-store').json(await this.#selection.replace(<object>await this.#body(request)));
		}));
		app.delete('/development/selection', route(async (request, response) => {
			this.#access.require(request, 'build.control');
			response.set('cache-control', 'no-store').json(await this.#selection.clear());
		}));

		app.get('/preview/entry.json', route(async (request, response) => {
			this.#access.require(request, 'artifacts.read');
			response.set('cache-control', 'no-store').json(await this.#preview.describe(this.#entry(request)));
		}));

		// The addresses of the document are relative to `preview/`, so the document only exists with the slash
		app.get('/preview', route(async (request, response) => {
			this.#access.require(request, 'artifacts.read');
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?')) : '';
			if (!request.path.endsWith('/')) return response.redirect(308, `preview/${query}`);

			const html = await this.#preview.document(this.#entry(request));
			response.set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
			response.type('text/html; charset=utf-8').send(html);
		}));
	}
}
