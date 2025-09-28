import type {
	IProvidersSettings,
	IProviderAuthData,
	IProviderData
} from '@beyond-js/packages/providers/settings/types';
import { def } from '../../default';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Load repository and scope configurations from environment variables for CI environments.
 */
export class VarsSettingsLoader implements IProvidersSettings {
	#scopes: Map<string, IProviderData> = new Map();
	get scopes() {
		return this.#scopes;
	}
	#hosts: Map<string, IProviderData> = new Map();
	get hosts() {
		return this.#hosts;
	}
	#default: IProviderData = def;
	get default() {
		return this.#default;
	}

	async load(): Promise<void> {
		const origin = 'env-vars';

		// 1. Default registry override
		if (process.env.NPM_REGISTRY) {
			this.#default.origin = origin;

			if (!process.env.NPM_REGISTRY.startsWith('https://')) {
				this.#default.base = process.env.NPM_REGISTRY;
				this.#default.hostname = process.env.NPM_REGISTRY.replace(/^https?:\/\//, '');

				// Remove trailing slash if present
				this.#default.base = this.#default.base.replace(/\/+$/, '');
			} else {
				this.#default.hostname = process.env.NPM_REGISTRY;
				this.#default.base = `https://${process.env.NPM_REGISTRY}`;
			}
		}

		// 2. Default registry auth token
		if (process.env.NPM_TOKEN) {
			this.#default.origin = origin;
			const token = process.env.NPM_TOKEN;
			this.#default.auth = { mode: 'token', token };
		}

		// 3. Default basic auth (base64)
		if (process.env.NPM_AUTH) {
			this.#default.origin = origin;
			const token = process.env.NPM_AUTH;
			this.#default.auth = { mode: 'basic', token };
		}

		// 4. Default user/pass auth
		if (process.env.NPM_USERNAME && process.env.NPM_PASSWORD) {
			this.#default.origin = origin;
			const user = process.env.NPM_USERNAME;
			const token = process.env.NPM_PASSWORD;
			this.#default.auth = { mode: 'user-pass', user, token };
		}

		const scopes: Map<string, string> = new Map();
		const hosts: Map<string, IProviderAuthData> = new Map();

		// 5. Scoped registry routing (e.g. NPM_SCOPE_@myorg=registry.mycompany.com)
		for (const key in process.env) {
			if (!key.startsWith('NPM_SCOPE_')) continue;
			const scope = key.slice('NPM_SCOPE_'.length);

			const hostname = process.env[key];
			if (!hostname) continue;

			scopes.set(scope, hostname);
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
					hosts.set(host, { mode: 'token', token: value });
					break;

				case 'BASIC':
					hosts.set(host, { mode: 'basic', token: value });
					break;

				case 'USERPASS': {
					const [user, pass] = value.split(':');
					if (!user || !pass) continue;
					hosts.set(host, { mode: 'user-pass', user, token: pass });
					break;
				}
			}
		}

		// Apply scopes
		for (const [scope, base] of scopes) {
			const hostname = base.replace(/^https?:\/\//, '').replace(/\/+$/, '');
			this.#scopes.set(scope, {
				hostname,
				base: base.replace(/\/+$/, ''),
				auth: hosts.get(hostname) || { mode: 'none' },
				origin
			});
		}

		// Apply hosts
		for (const [host, auth] of hosts) {
			const { hostname, base } = (() => {
				if (host.startsWith('https://') || host.startsWith('http://')) {
					// Clean host to get hostname (remove protocol and trailing slash)
					const hostname = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
					return { hostname, base: host.replace(/\/+$/, '') };
				}
				return { hostname: host, base: `https://${host}` };
			})();

			this.#hosts.set(hostname, { origin, hostname, base, auth });
		}
	}
}
