import { Identity, ModulePath, Options, ResourcePath } from '@beyond-js/artifact-api';

/**
 * Where a preview loads each public module from.
 *
 * A module in development is addressed relative to the preview document, which sits one level below the
 * base of the service: the same document works at the origin of the service and behind a proxy that
 * publishes the service under a path prefix. Every other module is addressed on the CDN, whose origin is
 * configured with `BEYOND_CDN_ORIGIN`. The path and the query are those of the compiled-module contract,
 * written by its codec: a service changes the origin and nothing else.
 *
 * The origin is read from the environment at each use, so a change of the variable while the service runs (the
 * `cdn.origin` setting of the host writes it) applies to the next description without a restart. An empty variable
 * is no origin; a variable the environment no longer names leaves the origin this object was created with. A
 * description that is being built while the variable changes may hold addresses of both origins; the next one
 * holds only the new one.
 */
export class Addresses {
	static VARIABLE = 'BEYOND_CDN_ORIGIN';

	#development = new Options({ target: 'browser', format: 'esm', env: 'development', min: 'false', sourcemap: 'inline' });
	#published = new Options({ target: 'browser', format: 'esm' });
	#node = new Options(Options.development);

	#environment: NodeJS.ProcessEnv;
	#started: string | undefined;

	/**
	 * The configured origin of the CDN, read now, undefined when the environment names none
	 */
	get cdn(): string | undefined {
		const given = this.#environment[Addresses.VARIABLE];
		return given === void 0 ? this.#started : Addresses.#origin(given);
	}

	/**
	 * The options of the modules in development, which the runtime also requests their updates with
	 */
	get options(): string {
		return this.#development.query;
	}

	constructor(environment: NodeJS.ProcessEnv = process.env) {
		this.#environment = environment;
		// A service that cannot say where the other modules come from does not start with a guess
		this.#started = Addresses.#origin(environment[Addresses.VARIABLE]);
	}

	/**
	 * The origin a value of the variable names
	 *
	 * @throws Error when it is neither empty nor an http or https origin
	 */
	static #origin(value: string | undefined): string | undefined {
		const configured = value?.trim().replace(/\/+$/, '');
		if (!configured) return;
		const valid = URL.canParse(configured) && ['http:', 'https:'].includes(new URL(configured).protocol);
		if (!valid) throw new Error(`${Addresses.VARIABLE} must be an http or https origin, and it is "${configured}"`);
		return configured;
	}

	/**
	 * The path of a module in the compiled-module contract, without the origin and the query. The registry is
	 * part of it: npm is written unprefixed, any other registry by its id, so an address names its source.
	 */
	path(name: string, version: string, subpath: string, registry = 'npm'): string {
		return ModulePath.format(new Identity({ registry, name, version, subpath }));
	}

	/**
	 * The address of a module served by this environment, relative to the preview document
	 */
	environment(name: string, version: string, subpath: string, registry?: string): string {
		return `..${this.path(name, version, subpath, registry)}?${this.#development.query}`;
	}

	/**
	 * The address a Node consumer of this environment requests a module at, relative to the preview document: the
	 * options of a Node development consumer, which the session description gives it
	 */
	node(name: string, version: string, subpath: string): string {
		return `..${this.path(name, version, subpath)}?${this.#node.query}`;
	}

	/**
	 * The address of the stylesheet of a module served by this environment, relative to the preview document
	 */
	styles(name: string, version: string, subpath: string, registry = 'npm'): string {
		const path = ResourcePath.format({ kind: 'style', identity: new Identity({ registry, name, version, subpath }) });
		return `..${path}?${this.#development.query}`;
	}

	/**
	 * The address of a module on the CDN, at an exact version and under the registry it is published to
	 *
	 * @returns undefined when no CDN origin is configured
	 */
	published(name: string, version: string, subpath: string, registry?: string): string | undefined {
		const cdn = this.cdn;
		return cdn && `${cdn}${this.path(name, version, subpath, registry)}?${this.#published.query}`;
	}

	/**
	 * The address of the stylesheet of a module on the CDN
	 */
	stylesheet(name: string, version: string, subpath: string, registry = 'npm'): string | undefined {
		const path = ResourcePath.format({ kind: 'style', identity: new Identity({ registry, name, version, subpath }) });
		const cdn = this.cdn;
		return cdn && `${cdn}${path}?${this.#published.query}`;
	}

	/**
	 * The package prefix of an address, which is the scope of the modules that address imports:
	 * `../m/@example/app@1.0.0/` for `../m/@example/app@1.0.0/modules/main?…`
	 */
	static prefix(url: string): string | undefined {
		const index = url.indexOf('/modules/');
		return index === -1 ? void 0 : url.slice(0, index + 1);
	}
}
