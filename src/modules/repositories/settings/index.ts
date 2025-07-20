import type { RepositoryAuthType } from '@beyond-js/packages/repositories/types';
import type { IRepositorySettings } from './types';
import { rules } from './rules';

// Import the loaders
import { LocalLoader } from './loaders/local';
import { CILoader } from './loaders/ci';
import { CDNLoader } from './loaders/cdn';

export /*bundle*/ class RepositoriesSettings implements IRepositorySettings {
	// Scopes to registry mapping: the key is the scope and the value is the repository host
	#scopes: Map<string, string> = new Map();
	get scopes() {
		return this.#scopes;
	}

	// The hosts map: the key is the host and the value is the repository auth type
	#hosts: Map<string, RepositoryAuthType> = new Map();
	get hosts() {
		return this.#hosts;
	}

	// The default repository host
	#default: { host: string; auth?: RepositoryAuthType } = { host: 'registry.npmjs.org' };
	get default() {
		return this.#default;
	}

	#merge(settings: IRepositorySettings) {
		// Merge scopes
		for (const [scope, host] of settings.scopes) {
			this.#scopes.set(scope, host);
		}

		// Merge hosts
		for (const [host, auth] of settings.hosts) {
			this.#hosts.set(host, auth);
		}

		// Set default if not already set
		if (settings.default) {
			const { host, auth } = settings.default;
			host && (this.#default.host = settings.default.host);
			auth && (this.#default.auth = auth);
		}
	}

	/**
	 * Load registry data from local, CI, and CDN sources.
	 *
	 * @param options Optional context path or workspace
	 */
	async load(options?: { path?: string; workspace?: string }): Promise<void> {
		const local = new LocalLoader();
		await local.process(options?.path, options?.workspace);
		this.#merge(local);

		const ci = new CILoader();
		await ci.process();
		this.#merge(ci);

		const cdn = new CDNLoader();
		await cdn.process();
		this.#merge(cdn);
	}
}
