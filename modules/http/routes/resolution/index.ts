import type { Application, NextFunction, Request, Response } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, Options, Policy, ResolutionRequest } from '@beyond-js/artifact-api';
import type { Sources } from '../modules/sources';
import { Tag } from '../modules/helpers';
import { Formats } from '../modules/formats';
import { Resolver } from './resolver';

/**
 * The resolution documents of the compiled-module contract: `GET /resolution.json` and `GET /importmap.json`,
 * with `target` and `format` together or neither. A development service computes them on every request from
 * the workspace it serves (`Resolver`) and answers them under the development policy, `no-store` with a
 * strong ETag. Without a query the document is the one of the options of the session, Node ES modules.
 */
export class ResolutionRoutes {
	#resolver: Resolver;

	constructor(delivery: Delivery, sources: Sources) {
		this.#resolver = new Resolver(delivery, sources);
	}

	static setup(app: Application, delivery: Delivery, sources: Sources) {
		const routes = new ResolutionRoutes(delivery, sources);
		const paths = Object.values(ResolutionRequest.PATHS);
		app.get(paths, (request, response, next) => routes.answer(request, response, next));
	}

	async answer(request: Request, response: Response, next: NextFunction) {
		try {
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1) : '';
			const asked = ResolutionRequest.parse(request.path, query);
			const { target, format } = asked.defaults ? new Options(Options.development) : asked;

			// Refused as a module request of the same format is
			if (!Formats.FORMATS.includes(format)) {
				throw new ContractError('OPTION_UNSUPPORTED', `This service does not produce "format=${format}". It delivers ES modules (format=esm) and System.register modules (format=system)`);
			}

			const resolution = await this.#resolver.build(target, format);
			const body = asked.kind === 'resolution' ? resolution.serialize() : `${JSON.stringify(resolution.importmap(), null, '\t')}\n`;
			const tag = new Tag(body, Policy.development.header());
			if (tag.current(request, response)) return;

			response.type(`${asked.media}; charset=utf-8`);
			response.status(200).send(Buffer.from(body, 'utf-8'));
		} catch (error) {
			next(error);
		}
	}
}
