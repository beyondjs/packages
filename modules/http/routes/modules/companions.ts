import type { Request, Response, NextFunction } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, Options, Policy, ResourcePath } from '@beyond-js/artifact-api';
import { Media } from '@beyond-js/packages/publication';
import { Diagnostics, Production, Stylesheet, Tag } from './helpers';
import type { Sources } from './sources';

/**
 * The sibling resource families of the compiled-module contract, for workspace modules: `/styles/<subpath>`
 * and `/assets/<path>`. They are read with the codec of `@beyond-js/artifact-api` and answered with what
 * the delivery produces now, under the development policy (`no-store`, strong ETag).
 *
 * An external source map is not served: development maps are inline, so `/maps/` answers
 * `OUTPUT_NOT_AVAILABLE`. A module without a stylesheet and a file the package does not declare answer the
 * same code, which never means that something could be built on request.
 */
export class Companions {
	#delivery: Delivery;
	#supported: (options: Options) => void;
	#sources: Sources;

	/**
	 * @param supported The check of the options this service honors, shared with the module route
	 * @param sources Which source each package is delivered from, shared with the module route
	 */
	constructor(delivery: Delivery, supported: (options: Options) => void, sources: Sources) {
		this.#delivery = delivery;
		this.#supported = supported;
		this.#sources = sources;
	}

	#send(request: Request, response: Response, content: string | Buffer, media: string): void {
		const tag = new Tag(content, Policy.development.header());
		if (tag.current(request, response)) return;
		response.type(media);
		response.status(200).send(typeof content === 'string' ? Buffer.from(content, 'utf-8') : content);
	}

	async answer(request: Request, response: Response, next: NextFunction) {
		try {
			const resource = ResourcePath.parse(request.path);
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1) : '';
			const options = <Options | undefined>resource.options(new URLSearchParams(query));
			options && this.#supported(options);

			await this.#sources.admit(resource.identity);
			const { name, version, subpath } = resource.identity;

			if (resource.kind === 'asset') {
				const { content, failure } = await this.#delivery.resources.asset({ name, version, path: resource.path });
				if (failure) throw new ContractError(failure.code, failure.message);
				return this.#send(request, response, content, Media.of(resource.path));
			}

			if (resource.kind === 'map') {
				// The module is resolved first, so an unknown module is reported as such
				const { failure } = await this.#delivery.module({ name, version, subpath }, options.conditions);
				if (failure) throw new ContractError(failure.code, failure.message, { diagnostics: Diagnostics.shared(failure.diagnostics) });
				throw new ContractError('OUTPUT_NOT_AVAILABLE', 'This service delivers inline source maps: request sourcemap=inline');
			}

			const { styles, key, failure } = await this.#delivery.resources.styles({ name, version, subpath }, options.conditions);
			if (failure) throw new ContractError(failure.code, failure.message, { diagnostics: Diagnostics.shared(failure.diagnostics) });
			Production.check(options, key);
			this.#send(request, response, Stylesheet.text(styles, options.sourcemap === 'inline'), 'text/css; charset=utf-8');
		} catch (error) {
			next(error);
		}
	}
}
