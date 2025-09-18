import type { IProviderAuth } from '@beyond-js/packages/providers/types';
import type { IProvidersSettings } from '../../types';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Load repository and scope configurations from environment variables for CI environments.
 */
export class VarsSettingsLoader implements IProvidersSettings {
	#scopes: Map<string, string> = new Map();
	get scopes() {
		return this.#scopes;
	}

	#hosts: Map<string, IProviderAuth> = new Map();
	get hosts() {
		return this.#hosts;
	}

	#default: { host: string; auth?: IProviderAuth } = { host: 'registry.npmjs.org' };
	get default() {
		return this.#default;
	}

	#normalize(url: string): string {
		return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
	}

	async load(): Promise<void> {
		const origin = 'env-vars';

		// 1. Default registry override
		if (process.env.NPM_REGISTRY) {
			this.#default.host = this.#normalize(process.env.NPM_REGISTRY);
		}

		// 2. Default registry auth token
		if (process.env.NPM_TOKEN) {
			const token = process.env.NPM_TOKEN;
			this.#default.auth = { mode: 'token', token, origin };
		}

		// 3. Default basic auth (base64)
		if (process.env.NPM_AUTH) {
			const token = process.env.NPM_AUTH;
			this.#default.auth = { mode: 'basic', token, origin };
		}

		// 4. Default user/pass auth
		if (process.env.NPM_USERNAME && process.env.NPM_PASSWORD) {
			const user = process.env.NPM_USERNAME;
			const token = process.env.NPM_PASSWORD;
			this.#default.auth = { mode: 'user-pass', user, token, origin };
		}

		// 5. Scoped registry routing (e.g. NPM_SCOPE_@myorg=registry.mycompany.com)
		for (const key in process.env) {
			if (!key.startsWith('NPM_SCOPE_')) continue;
			const scope = key.slice('NPM_SCOPE_'.length);
			const host = this.#normalize(process.env[key]!);
			this.#scopes.set(scope, host);
		}

		// 6. Host-specific auth (e.g. NPM_HOST_TOKEN_registry.myco.com)
		for (const key in process.env) {
			const match = key.match(/^NPM_HOST_(TOKEN|BASIC|USERPASS)_(.+)$/);
			if (!match) continue;

			const [, mode, host] = match;
			const value = process.env[key];
			if (!value) continue;

			switch (mode) {
				case 'TOKEN':
					this.#hosts.set(host, { mode: 'token', token: value, origin });
					break;

				case 'BASIC':
					this.#hosts.set(host, { mode: 'basic', token: value, origin });
					break;

				case 'USERPASS': {
					const [user, pass] = value.split(':');
					if (!user || !pass) continue;
					this.#hosts.set(host, { mode: 'user-pass', user, token: pass, origin });
					break;
				}
			}
		}
	}
}
