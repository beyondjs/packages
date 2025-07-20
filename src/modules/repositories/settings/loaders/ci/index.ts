import type { RepositoryAuthType } from '@beyond-js/packages/repositories/types';
import type { IRepositorySettings } from '../../types';

/**
 * Load repository and scope configurations from environment variables for CI environments.
 */
export class CISettingsLoader implements IRepositorySettings {
	#scopes: Map<string, string> = new Map();
	get scopes() {
		return this.#scopes;
	}

	#hosts: Map<string, RepositoryAuthType> = new Map();
	get hosts() {
		return this.#hosts;
	}

	#default: { host: string; auth?: RepositoryAuthType } = { host: 'registry.npmjs.org' };
	get default() {
		return this.#default;
	}

	#normalize(url: string): string {
		return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
	}

	async process(): Promise<void> {
		// 1. Default registry override
		if (process.env.NPM_REGISTRY) {
			this.#default.host = this.#normalize(process.env.NPM_REGISTRY);
		}

		// 2. Default registry auth token
		if (process.env.NPM_TOKEN) {
			this.#default.auth = {
				mode: 'token',
				token: process.env.NPM_TOKEN,
				origin: 'env:NPM_TOKEN'
			};
		}

		// 3. Default basic auth (base64)
		if (process.env.NPM_AUTH) {
			this.#default.auth = {
				mode: 'basic',
				token: process.env.NPM_AUTH,
				origin: 'env:NPM_AUTH'
			};
		}

		// 4. Default user/pass auth
		if (process.env.NPM_USERNAME && process.env.NPM_PASSWORD) {
			this.#default.auth = {
				mode: 'user-pass',
				user: process.env.NPM_USERNAME,
				token: process.env.NPM_PASSWORD,
				origin: 'env:NPM_USERNAME/PASSWORD'
			};
		}

		// 5. Scoped registry routing (e.g. NPM_SCOPE_@myorg=registry.mycompany.com)
		for (const key in process.env) {
			if (!key.startsWith('NPM_SCOPE_')) continue;
			const scope = key.slice('NPM_SCOPE_'.length);
			const host = this.#normalize(process.env[key]!);
			this.#scopes.set(scope, host);
		}

		// 6. Host-specific auth (e.g. NPM_HOST_token_registry.myco.com)
		for (const key in process.env) {
			const match = key.match(/^NPM_HOST_(token|basic|userpass)_(.+)$/);
			if (!match) continue;

			const [, mode, host] = match;
			const value = process.env[key];
			if (!value) continue;

			const origin = `env:${key}`;
			switch (mode) {
				case 'token':
					this.#hosts.set(host, { mode: 'token', token: value, origin });
					break;

				case 'basic':
					this.#hosts.set(host, { mode: 'basic', token: value, origin });
					break;

				case 'userpass': {
					const [user, pass] = value.split(':');
					if (!user || !pass) continue;
					this.#hosts.set(host, { mode: 'user-pass', user, token: pass, origin });
					break;
				}
			}
		}
	}
}
