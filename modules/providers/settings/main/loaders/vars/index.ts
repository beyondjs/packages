import type { IProviderAuthData } from '@beyond-js/packages/providers/settings/types';
import { Layer } from '../../layer';

/**
 * Reads registry, scope and credential declarations from environment variables, for CI environments.
 *
 * - NPM_REGISTRY: default registry, with or without scheme (`https://host/npm`, `host:4873`)
 * - NPM_TOKEN, NPM_AUTH, NPM_USERNAME + NPM_PASSWORD: credentials of the default registry
 * - NPM_SCOPE_<@scope>: registry of a scope
 * - NPM_HOST_TOKEN_<host>, NPM_HOST_BASIC_<host>, NPM_HOST_USERPASS_<host>: credentials of a host
 */
export class VarsSettingsLoader {
	#layer = new Layer('env-vars');
	get layer() {
		return this.#layer;
	}

	async load(env: Record<string, string | undefined>): Promise<void> {
		const layer = (this.#layer = new Layer('env-vars'));

		// The address is normalized by the layer whatever its form: a value with a scheme used to receive
		// a second scheme, and one without it was stored as a base without scheme
		if (env.NPM_REGISTRY) layer.default(env.NPM_REGISTRY);

		if (env.NPM_USERNAME && env.NPM_PASSWORD) {
			layer.credentials({ mode: 'user-pass', user: env.NPM_USERNAME, token: env.NPM_PASSWORD });
		}
		if (env.NPM_AUTH) layer.credentials({ mode: 'basic', token: env.NPM_AUTH });
		if (env.NPM_TOKEN) layer.credentials({ mode: 'token', token: env.NPM_TOKEN });

		for (const key of Object.keys(env).sort()) {
			const value = env[key];
			if (!value) continue;

			if (key.startsWith('NPM_SCOPE_')) {
				layer.scope(key.slice('NPM_SCOPE_'.length), value);
				continue;
			}

			const match = /^NPM_HOST_(TOKEN|BASIC|USERPASS)_(.+)$/.exec(key);
			if (!match) continue;
			const [, mode, host] = match;

			let auth: IProviderAuthData;
			if (mode === 'TOKEN') auth = { mode: 'token', token: value };
			else if (mode === 'BASIC') auth = { mode: 'basic', token: value };
			else {
				// Only the first colon separates: a password may contain colons
				const index = value.indexOf(':');
				if (index < 1 || index === value.length - 1) continue;
				auth = { mode: 'user-pass', user: value.slice(0, index), token: value.slice(index + 1) };
			}
			layer.host(host, auth);
		}
	}
}
