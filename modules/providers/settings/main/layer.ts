import type { IProviderAuthData, OriginType } from '@beyond-js/packages/providers/settings/types';
import { Endpoint } from './endpoint';

/**
 * What one source of settings declares (one rc file, the environment, the database, explicit options).
 * Layers hold raw declarations keyed by normalized addresses; `ProvidersSettings` composes them by
 * precedence. A layer is created per load: no declaration is shared between instances.
 */
export class Layer {
	#origin: OriginType;
	get origin() {
		return this.#origin;
	}

	#registry?: Endpoint;
	/**
	 * The default registry declared by this layer, if any
	 */
	get registry() {
		return this.#registry;
	}

	#auth?: IProviderAuthData;
	/**
	 * Credentials declared without a host, which apply to the default registry only
	 */
	get auth() {
		return this.#auth;
	}

	#scopes: Map<string, Endpoint> = new Map();
	get scopes() {
		return this.#scopes;
	}

	#hosts: Map<string, IProviderAuthData> = new Map();
	/**
	 * Credentials by normalized `host[:port][/prefix]`
	 */
	get hosts() {
		return this.#hosts;
	}

	#warnings: string[] = [];
	get warnings() {
		return this.#warnings;
	}

	constructor(origin: OriginType) {
		this.#origin = origin;
	}

	#endpoint(value: string, what: string): Endpoint | undefined {
		const endpoint = new Endpoint(value);
		if (endpoint.valid) return endpoint;

		// The value itself is not reported: a malformed address may embed credentials
		this.#warnings.push(`${what} declared by "${this.#origin}" is not a valid HTTP(S) address`);
		return;
	}

	default(value: string) {
		const endpoint = this.#endpoint(value, 'The default registry');
		if (endpoint) this.#registry = endpoint;
	}

	credentials(auth: IProviderAuthData) {
		this.#auth = { ...auth };
	}

	scope(name: string, value: string) {
		if (!name.startsWith('@')) name = `@${name}`;
		const endpoint = this.#endpoint(value, `The registry of scope "${name}"`);
		if (endpoint) this.#scopes.set(name, endpoint);
	}

	host(value: string, auth: IProviderAuthData) {
		const endpoint = this.#endpoint(value, 'A host with credentials');
		if (endpoint) this.#hosts.set(endpoint.registry, { ...this.#hosts.get(endpoint.registry), ...auth });
	}
}
