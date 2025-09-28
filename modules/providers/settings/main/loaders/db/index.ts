import type { IProvidersSettings, IProviderData } from '@beyond-js/packages/providers/settings/types';
import type { ICdnProvidersSettings } from '@beyond-js/packages/persistence/types/cdn';
import { def } from '../../default';

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

	async load(credentials: CdnCredentials): Promise<void> {
		const origin = 'db';
		if (!credentials || !credentials.account || !credentials.project || !credentials.token) {
			throw new Error('Invalid credentials provided for Firestore settings loader');
		}

		// TODO: Load document from Firestore collection using `credentials.account` and `credentials.project`
		// Verify permissions using `credentials.token`
		// Expected document structure:
		const data: ICdnProvidersSettings = {};

		// Apply default
		if (data.default) this.#default = { ...data.default, origin };

		// Apply scopes
		const scopes = data.scopes || {};
		for (const scope in scopes) {
			this.#scopes.set(scope, { ...scopes[scope], origin });
		}

		// Apply hosts
		const hosts = data.hosts || {};
		for (const host in hosts || {}) {
			this.#hosts.set(host, { ...hosts[host], origin });
		}
	}
}
