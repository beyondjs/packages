import { Identity, ModulePath, Options, ResourcePath } from '@beyond-js/artifact-api';

/**
 * Where a preview loads each public module from.
 *
 * A module in development is addressed relative to the preview document, which sits one level below the
 * base of the service: the same document works at the origin of the service and behind a proxy that
 * publishes the service under a path prefix. Every other module is addressed on the CDN, whose origin is
 * configured with `BEYOND_CDN_ORIGIN`. The path and the query are those of the compiled-module contract,
 * written by its codec: a service changes the origin and nothing else.
 */
export class Addresses {
	static VARIABLE = 'BEYOND_CDN_ORIGIN';

	#development = new Options({ target: 'browser', format: 'esm', env: 'development', min: 'false', sourcemap: 'inline' });
	#published = new Options({ target: 'browser', format: 'esm' });

	#cdn: string;

	/**
	 * The configured origin of the CDN, undefined when the environment names none
	 */
	get cdn() {
		return this.#cdn;
	}

	/**
	 * The options of the modules in development, which the runtime also requests their updates with
	 */
	get options(): string {
		return this.#development.query;
	}

	constructor(environment: NodeJS.ProcessEnv = process.env) {
		const configured = environment[Addresses.VARIABLE]?.trim().replace(/\/+$/, '');
		if (!configured) return;

		// A service that cannot say where the other modules come from does not start with a guess
		const valid = URL.canParse(configured) && ['http:', 'https:'].includes(new URL(configured).protocol);
		if (!valid) throw new Error(`${Addresses.VARIABLE} must be an http or https origin, and it is "${configured}"`);
		this.#cdn = configured;
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
		return this.#cdn && `${this.#cdn}${this.path(name, version, subpath, registry)}?${this.#published.query}`;
	}

	/**
	 * The address of the stylesheet of a module on the CDN
	 */
	stylesheet(name: string, version: string, subpath: string, registry = 'npm'): string | undefined {
		const path = ResourcePath.format({ kind: 'style', identity: new Identity({ registry, name, version, subpath }) });
		return this.#cdn && `${this.#cdn}${path}?${this.#published.query}`;
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
