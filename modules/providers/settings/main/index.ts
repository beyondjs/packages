import type {
	IProvidersSettings,
	IProviderData,
	IProviderAuthData,
	IProvidersValues,
	OriginType
} from '@beyond-js/packages/providers/settings/types';
import { Endpoint } from './endpoint';
import { Layer } from './layer';
import { LocalLoader } from './loaders/local';
import { VarsSettingsLoader } from './loaders/vars';
import { DbSettingsLoader } from './loaders/db';
import * as dotenv from 'dotenv';

/**
 * Options for retrieving provider settings.
 */
interface IGetOptions {
	package?: string; // Full package name including scope (e.g. @beyond-js/widgets)
	scope?: string; // Package scope (e.g. @beyond-js)
	hostname?: string; // Host of a git or tarball provider, with its port when present (e.g. github.com)
	base?: string; // Scheme and host to request an unregistered host at (defaults to https)
}

export /*bundle*/ interface ICdnProviderSettingsOptions {
	project: string; // The project id
}

export /*bundle*/ interface IProvidersSettingsOptions {
	path?: string; // Optional context path for local settings
	workspace?: string; // Optional workspace for local settings
	cdn?: ICdnProviderSettingsOptions;

	// Path of the user rc file; false ignores it. Defaults to the rc file of the home directory
	user?: string | false;
	// Path of the global rc file; false ignores it. When undefined it is asked to the package manager
	global?: string | false;
	// Environment to read; false ignores it. Defaults to the environment of the process
	env?: Record<string, string | undefined> | false;
	// Explicit settings, for example those of one tenant. Highest precedence
	values?: IProvidersValues;
}

const NPM = 'https://registry.npmjs.org';

/**
 * The registries, hosts and credentials that apply to a package, composed from every source of settings.
 *
 * Precedence, from highest to lowest: explicit `values` > database (CDN project) > environment
 * variables > project rc > workspace rc > user rc > global rc > built-in default. A higher source
 * replaces a lower one key by key (default registry, each scope, each host credential).
 *
 * Every instance owns its state: nothing is shared between instances, so settings of two tenants
 * loaded in one process never mix.
 */
export /*bundle*/ class ProvidersSettings implements IProvidersSettings {
	#options: IProvidersSettingsOptions;
	get options() {
		return this.#options;
	}

	// Composed declarations
	#registry: { endpoint: Endpoint; origin: OriginType };
	#auth?: { auth: IProviderAuthData; origin: OriginType };
	#routes: Map<string, { endpoint: Endpoint; origin: OriginType }> = new Map();
	#credentials: Map<string, { auth: IProviderAuthData; origin: OriginType }> = new Map();

	#scopes: Map<string, IProviderData> = new Map();
	get scopes() {
		return this.#scopes;
	}

	#hosts: Map<string, IProviderData> = new Map();
	/**
	 * Hosts with credentials, keyed by normalized `host[:port][/prefix]`
	 */
	get hosts() {
		return this.#hosts;
	}

	#default: IProviderData;
	get default() {
		return this.#default;
	}

	#warnings: string[] = [];
	/**
	 * Declarations that were ignored. They never include a declared value
	 */
	get warnings() {
		return this.#warnings;
	}

	#loaded = false;
	get loaded() {
		return this.#loaded;
	}

	constructor(options: IProvidersSettingsOptions = {}) {
		this.#options = options;
	}

	/**
	 * Credentials of an address: the most specific host declaration that contains it, and the host-less
	 * credentials only for the default registry
	 */
	#authenticate(endpoint: Endpoint): { auth: IProviderAuthData; origin?: OriginType } {
		for (const key of endpoint.keys) {
			if (this.#credentials.has(key)) return this.#credentials.get(key);
		}
		if (this.#auth && endpoint.registry === this.#registry.endpoint.registry) return this.#auth;
		return { auth: { mode: 'none' } };
	}

	#provider(endpoint: Endpoint, origin: OriginType): IProviderData {
		const { auth } = this.#authenticate(endpoint);
		const { hostname, base, registry } = endpoint;
		return { origin, hostname, base, registry, auth: { ...auth } };
	}

	get({ package: pkg, scope, hostname, base }: IGetOptions): IProviderData {
		if (!this.#loaded) {
			throw new Error('Providers settings have not been loaded yet. Call the load() method first.');
		}

		// A host (git or tarball provider): its credentials if declared, anonymous otherwise
		if (hostname) {
			const endpoint = new Endpoint(base || hostname);
			if (!endpoint.valid) throw new Error('The host of the provider is not a valid address');

			const registered = endpoint.keys.some(key => this.#credentials.has(key));
			return this.#provider(endpoint, registered ? this.#authenticate(endpoint).origin : 'unregistered');
		}

		scope = pkg && pkg.startsWith('@') ? pkg.split('/')[0] : scope;
		if (scope && this.#scopes.has(scope)) return { ...this.#scopes.get(scope) };

		return { ...this.#default };
	}

	/**
	 * Applies a layer over the ones already applied: call from the lowest to the highest precedence
	 */
	#apply(layer: Layer) {
		const { origin } = layer;
		if (layer.registry) this.#registry = { endpoint: layer.registry, origin };
		if (layer.auth) this.#auth = { auth: layer.auth, origin };
		layer.scopes.forEach((endpoint, scope) => this.#routes.set(scope, { endpoint, origin }));
		layer.hosts.forEach((auth, host) => this.#credentials.set(host, { auth, origin }));
		this.#warnings.push(...layer.warnings);
	}

	#explicit(values: IProvidersValues): Layer {
		const layer = new Layer('options');
		values.default?.registry && layer.default(values.default.registry);
		values.default?.auth && layer.credentials(values.default.auth);

		for (const [scope, { registry, auth }] of Object.entries(values.scopes || {})) {
			layer.scope(scope, registry);
			auth && auth.mode !== 'none' && layer.host(registry, auth);
		}
		for (const [host, auth] of Object.entries(values.hosts || {})) layer.host(host, auth);
		return layer;
	}

	/**
	 * Load registry data from local, CI, CDN and explicit sources.
	 */
	async load(): Promise<void> {
		const { path, workspace, cdn, user, global, values } = this.#options;
		// The environment of the process includes the `.env` file of the working directory, as it always
		// did. An environment given explicitly, or disabled, never reads it
		this.#options.env === void 0 && dotenv.config();
		const env = this.#options.env === false ? {} : this.#options.env || process.env;

		this.#registry = { endpoint: new Endpoint(NPM), origin: 'default' };
		this.#auth = void 0;
		this.#routes.clear();
		this.#credentials.clear();
		this.#warnings = [];

		// Lowest precedence first: global → user → workspace → project rc files
		const local = new LocalLoader({ user, global }, env);
		path && (await local.load(path, workspace));
		[...local.layers].reverse().forEach(layer => this.#apply(layer));

		const vars = new VarsSettingsLoader();
		await vars.load(env);
		this.#apply(vars.layer);

		if (cdn) {
			const db = new DbSettingsLoader();
			await db.load(cdn.project);
			db.error && this.#warnings.push(db.error.message);
			this.#apply(db.layer);
		}

		values && this.#apply(this.#explicit(values));

		// Resolve the public views once every declaration is known
		this.#default = this.#provider(this.#registry.endpoint, this.#registry.origin);

		this.#scopes.clear();
		this.#routes.forEach(({ endpoint, origin }, scope) =>
			this.#scopes.set(scope, this.#provider(endpoint, origin))
		);

		this.#hosts.clear();
		this.#credentials.forEach(({ origin }, host) =>
			this.#hosts.set(host, this.#provider(new Endpoint(host), origin))
		);

		this.#loaded = true;
	}
}
