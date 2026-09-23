import type { Request, Response, NextFunction, Application } from 'express';
import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, Cors, ModulePath, Options, ResourcePath } from '@beyond-js/artifact-api';
import { Diagnostics, Production, Tag } from './helpers';
import { Companions } from './companions';
import { Formats } from './formats';
import type { Sources } from './sources';
import { Kinds } from './kinds';

/**
 * The compiled-module routes of the shared contract, answered with the artifacts that Packages builds.
 *
 * Paths and options are read with the codec of `@beyond-js/artifact-api`, the one implementation of the
 * grammar, and one handler serves every spelling of it. This adapter delivers what the development pipeline
 * produces: unminified development modules, as ES modules or as `System.register` modules (`format=system`,
 * converted from the ES module), with an inline source map or none. Any other combination is rejected as
 * OPTION_UNSUPPORTED instead of being answered with output that is not what was asked for, and no companion
 * resource (external map, declarations, styles) is advertised because none is served.
 *
 * A package is addressed by its source (`Sources`): the workspace and npm unprefixed, another registry by its
 * id, as its lockfile recorded it.
 */
export class ModulesRoutes {
	#delivery: Delivery;
	#companions: Companions;
	#sources: Sources;
	#formats: Formats;

	/**
	 * @param sources Which source each package is delivered from
	 * @param formats The formats a module is answered in, shared with the updates of composed modules
	 */
	constructor(delivery: Delivery, sources: Sources, formats: Formats) {
		this.#delivery = delivery;
		this.#sources = sources;
		this.#formats = formats;
		this.#companions = new Companions(delivery, options => this.#supported(options), sources);
	}

	static setup(app: Application, delivery: Delivery, sources: Sources, formats: Formats) {
		const routes = new ModulesRoutes(delivery, sources, formats);
		app.get('/m/*', (request, response, next) => routes.resource(request, response, next));
	}

	/**
	 * Compiled modules, their companions and the resolution documents may be loaded by a page of another origin,
	 * such as an existing site that embeds a widget served here: a module script needs the cross-origin header,
	 * a page that revalidates needs to read the validator, and one that fails needs to read why. The headers are
	 * those of the contract (`Cors`), on every answer, errors included.
	 */
	static cors(app: Application) {
		app.use((request: Request, response: Response, next: NextFunction) => {
			Object.entries(Cors.headers()).forEach(([name, value]) => response.setHeader(name, value));
			request.method === 'OPTIONS' ? response.status(204).end() : next();
		});
	}

	/**
	 * Sends a request to the family its path addresses. A module path is answered exactly as before the
	 * sibling families existed; a path that cannot be read is reported by the module grammar.
	 */
	async resource(request: Request, response: Response, next: NextFunction) {
		let kind = 'module';
		try {
			kind = ResourcePath.parse(request.path).kind;
		} catch {
			// The module handler reads the path again and reports the error of the contract
		}
		return kind === 'module' ? this.module(request, response, next) : this.#companions.answer(request, response, next);
	}

	/**
	 * The options this adapter can honor. Development output is unminified and its map inline or absent.
	 * Production output is what a module builds as its production conditional, minified; a module that
	 * builds none is refused for production once it is resolved (see `production`).
	 */
	#supported(options: Options): void {
		const unsupported = (option: string, value: unknown, hint: string) => {
			throw new ContractError('OPTION_UNSUPPORTED', `This service does not produce "${option}=${value}". ${hint}`);
		};
		const explicit = 'Request development output explicitly: env=development&min=false&sourcemap=inline';
		const production = 'Request production output explicitly: env=production&min=true';

		!Formats.FORMATS.includes(options.format) && unsupported('format', options.format, 'It delivers ES modules (format=esm) and System.register modules (format=system)');
		options.env === 'development' && options.min && unsupported('min', options.min, explicit);
		options.env === 'production' && !options.min && unsupported('min', options.min, production);
		options.sourcemap === 'external' && unsupported('sourcemap', 'external', explicit);
		options.types && unsupported('types', true, 'Declarations are not served');
		options.css && unsupported('css', true, 'Styles are not served');
	}


	async module(request: Request, response: Response, next: NextFunction) {
		try {
			const identity = ModulePath.parse(request.path);
			const query = request.originalUrl.includes('?') ? request.originalUrl.slice(request.originalUrl.indexOf('?') + 1) : '';
			const options = new Options(new URLSearchParams(query));
			this.#supported(options);
			await this.#sources.admit(identity);

			const { name, version, subpath } = identity;
			// A style module has no JavaScript output: the identity is known and this output of it does not exist,
			// which a published service answers alike for a release that prepared the stylesheet only
			const stylesheet = ResourcePath.format({ kind: 'style', identity });
			const workspace = (await this.#delivery.published()).find(one => one.name === name && one.version === version && one.subpath === subpath);
			if (workspace && (await Kinds.style(workspace))) {
				throw new ContractError('OUTPUT_NOT_AVAILABLE', `"${identity.specifier}" is a stylesheet and has no JavaScript output: its stylesheet is ${stylesheet}`);
			}

			const { delivered, failure } = await this.#delivery.module({ name, version, subpath }, options.conditions);
			const style = failure?.diagnostics?.find(({ code }) => code === 'OUTPUT_NOT_FOUND');
			if (style) throw new ContractError('OUTPUT_NOT_AVAILABLE', `${style.message}. Its stylesheet is ${stylesheet}`);
			if (failure) throw new ContractError(failure.code, failure.message, { diagnostics: Diagnostics.shared(failure.diagnostics) });
			Production.check(options, delivered.key);

			const map = options.sourcemap === 'inline' ? 'inline' : 'none';
			const code = this.#formats.code(delivered.code(map), options.format, `${delivered.hash}:${map}`);

			// Development output changes with the sources, so it is revalidated on every request
			const tag = new Tag(code, 'no-store');
			if (tag.current(request, response)) return;

			response.type('application/javascript; charset=utf-8');
			response.status(200).send(Buffer.from(code, 'utf-8'));
		} catch (error) {
			next(error);
		}
	}
}
