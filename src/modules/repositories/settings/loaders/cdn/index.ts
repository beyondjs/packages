import type { RepositoryAuthType } from '@beyond-js/packages/repositories/types';
import type { IRepositorySettings } from '../../types';

/**
 * Interface for the credentials needed to access Firestore-based settings.
 */
interface Credentials {
	account: string;
	project: string;
	token: string; // Access token to authenticate the request
}

/**
 * Firestore-based repository settings loader.
 */
export class FirestoreSettingsLoader implements IRepositorySettings {
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

	async process(credentials: Credentials): Promise<void> {
		// TODO: Load document from Firestore collection using `credentials.account` and `credentials.project`
		// Verify permissions using `credentials.token`
		// Expected document structure:
		const data = {
			default: {
				host: 'registry.mycompany.com',
				auth: {
					mode: 'token', // 'token' | 'basic' | 'user-pass'
					token: 'abcdef123456',
					user: 'my-user', // only when mode is 'user-pass'
					origin: 'firestore:doc-path'
				}
			},
			scopes: {
				'@myorg': 'registry.mycompany.com',
				'@internal': 'registry.dev.com'
			},
			hosts: {
				'registry.mycompany.com': {
					mode: 'token',
					token: 'token123',
					origin: 'firestore:doc-path'
				},
				'registry.dev.com': {
					mode: 'user-pass',
					user: 'ci-user',
					token: 'ci-pass',
					origin: 'firestore:doc-path'
				}
			}
		};

		// Apply default
		if (data.default?.host) {
			this.#default.host = this.#normalize(data.default.host);
		}
		if (data.default?.auth) {
			this.#default.auth = data.default.auth;
		}

		// Apply scopes
		for (const scope in data.scopes || {}) {
			const host = this.#normalize(data.scopes[scope]);
			this.#scopes.set(scope, host);
		}

		// Apply hosts
		for (const host in data.hosts || {}) {
			this.#hosts.set(host, data.hosts[host]);
		}
	}
}
