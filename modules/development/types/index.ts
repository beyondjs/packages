import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Access } from '../access';
import type { IBuildable } from '../builds';
import type { Files } from '../files';
import { DevelopmentError } from '../error';
import { Instances } from '../preview/instances';
import { Contexts } from './context';
import type { ITypesDocument } from './document';
import { Generated } from './generated';
import { Installations } from './installations';
import { Installed } from './installed';
import { Modules } from './modules';
import { TypesRequest } from './request';

/**
 * What type browsing works with: the delivery, the File API and the access guard of the development routes
 */
export interface ITypesSpecs {
	delivery: IBuildable;
	files: Files;
	access: Access;
}

/**
 * Type browsing (`beyond-types/1`): `GET /types?specifier=&importer=` answers the declaration a consumer's type check
 * reads for a public module, with its provenance, or the precise reason there is none. It needs `inspect.read`, as
 * `GET /declarations` does, whose contract is unchanged.
 *
 * - A module of the workspace (or one the toolchain supplies) answers the consolidated declaration its bundler
 *   generates (`Generated`): `generated`, or `DECLARATION_PRODUCER_MISSING` for a bundler without a `types`
 *   conditional, `TYPES_UNSUPPORTED` for a style module, `DECLARATION_INVALID` for one that does not check.
 * - Any other package is resolved from the importer (`TypesRequest`, `Contexts`) as the type check resolves it, and
 *   answers what that package declares (`Installed`): `package` or `types-package`, or `TYPES_ACCESS`,
 *   `TYPES_UNSUPPORTED`, `DECLARATION_NOT_FOUND`.
 *
 * Every file is read inside its package and within a bound, and nothing is synthesized. Each answer lists the public
 * specifiers the declaration imports with the importer that resolves them, so a client follows them. The suite's
 * `docs/products/packages/developer-journey.md` and this repository's `docs/development-contract.md` describe it.
 */
export class Types {
	static PROTOCOL = 'beyond-types/1';

	#delivery: IBuildable;
	#files: Files;
	#access: Access;
	#generated: Generated;

	constructor({ delivery, files, access }: ITypesSpecs) {
		this.#delivery = delivery;
		this.#files = files;
		this.#access = access;
		this.#generated = new Generated(delivery, files);
	}

	/**
	 * The declaration a request names, with the cursor of the source log a generated one is consistent with
	 *
	 * @param query The query of `GET /types`
	 */
	async read(query: Record<string, unknown>): Promise<{ document: ITypesDocument; cursor?: string }> {
		const request = new TypesRequest(query);
		await this.#delivery.refresh?.();
		const modules = new Modules(await this.#delivery.published());

		const module = modules.find(request.specified);
		if (module) return this.#generated.read(module, request);

		const { name, version, subpath } = request.specified;
		if (modules.owns(name)) {
			const published = modules.names(name).join(', ');
			throw new DevelopmentError('DECLARATION_NOT_FOUND', `"${request.specifier}" is not a public module of the workspace, whose package "${name}" publishes ${published}`, 404);
		}
		if (version) {
			const message = `"${request.specifier}" names a version: versioned specifiers name modules of the workspace, and an installed package is named by its bare specifier ("${name}${subpath === '.' ? '' : subpath.slice(1)}") and its importer`;
			throw new DevelopmentError('DECLARATION_NOT_FOUND', message, 404);
		}

		const instances = Instances.of(this.#delivery);
		const installations = new Installations();
		const contexts = new Contexts({ root: this.#files.root, modules, instances, execution: this.#delivery.execution, installations });
		const context = await contexts.of(request.chain);
		return { document: await new Installed(this.#delivery, instances, installations).read(request, context) };
	}

	setup(app: Application): void {
		const route = (handler: (request: Request, response: Response) => unknown): RequestHandler =>
			(request: Request, response: Response, next: NextFunction) => Promise.resolve().then(() => handler(request, response)).catch(next);

		app.get('/types', route(async (request, response) => {
			this.#access.require(request, 'inspect.read');
			const { document, cursor } = await this.read(<Record<string, unknown>>request.query);
			response.set({ 'cache-control': 'no-store', ...(cursor ? { 'beyond-cursor': cursor } : {}) }).json(document);
		}));
	}
}
