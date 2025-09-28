import type { IProvidersSettings, IProviderAuth } from '@beyond-js/packages/providers/settings/types';
import type { ICdnProvidersSettings } from '@beyond-js/packages/persistence/types/cdn';

/**
 * Interface for the credentials needed to access Firestore-based settings.
 */
export interface CdnCredentials {
	account: string;
	project: string;
	token: string; // Access token to authenticate the request
}

/**
 * Firestore-based repository settings loader.
 */
export class DbSettingsLoader implements IProvidersSettings {
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

	async load(credentials: CdnCredentials): Promise<void> {
		const origin = 'db';
		if (!credentials || !credentials.account || !credentials.project || !credentials.token) {
			throw new Error('Invalid credentials provided for Firestore settings loader');
		}

		// TODO: Load document from Firestore collection using `credentials.account` and `credentials.project`
		// Verify permissions using `credentials.token`
		// Expected document structure:
		const data: ICdnProvidersSettings = {
			default: {
				host: 'registry.mycompany.com',
				auth: {
					mode: 'token', // 'token' | 'basic' | 'user-pass'
					token: 'abcdef123456',
					user: 'my-user' // only when mode is 'user-pass'
				}
			},
			scopes: {
				'@myorg': 'registry.mycompany.com',
				'@internal': 'registry.dev.com'
			},
			hosts: {
				'registry.mycompany.com': {
					mode: 'token',
					token: 'token123'
				},
				'registry.dev.com': {
					mode: 'user-pass',
					user: 'ci-user',
					token: 'ci-pass'
				}
			}
		};

		// Apply default
		if (data.default?.host) {
			this.#default.host = this.#normalize(data.default.host);
		}
		if (data.default?.auth) {
			const { mode, token, user } = data.default.auth;
			this.#default.auth = { mode, token, user, origin: 'db' };
		}

		// Apply scopes
		for (const scope in data.scopes || {}) {
			const host = this.#normalize(data.scopes[scope]);
			this.#scopes.set(scope, host);
		}

		// Apply hosts
		for (const host in data.hosts || {}) {
			this.#hosts.set(host, { origin, ...data.hosts[host] });
		}
	}
}
