import type { IRepositoryAuth } from '@beyond-js/packages/repositories/types';
import type { IRepositoriesSettings } from './types';
import { TokenTools } from './tools';

// Import the loaders
import { LocalLoader } from './loaders/local';
import { VarsSettingsLoader } from './loaders/vars';
import { DbSettingsLoader, type CdnCredentials } from './loaders/db';

export /*bundle*/ interface IRepositoriesSettingsOptions {
	path?: string; // Optional context path for local settings
	workspace?: string; // Optional workspace for local settings
	cdn?: {
		credentials: CdnCredentials; // Credentials for CDN-based settings
	};
}

export /*bundle*/ class RepositoriesSettings implements IRepositoriesSettings {
	#options: IRepositoriesSettingsOptions;
	get options() {
		return this.#options;
	}

	// Scopes to registry mapping: the key is the scope and the value is the repository host
	#scopes: Map<string, string> = new Map();
	get scopes() {
		return this.#scopes;
	}

	// The hosts map: the key is the host and the value is the repository auth type
	#hosts: Map<string, IRepositoryAuth> = new Map();
	get hosts() {
		return this.#hosts;
	}

	// The default repository host
	#default: { host: string; auth?: IRepositoryAuth } = { host: 'registry.npmjs.org' };
	get default() {
		return this.#default;
	}

	constructor(options: IRepositoriesSettingsOptions = {}) {
		this.#options = options;
	}

	#merge(settings: IRepositoriesSettings) {
		// Merge scopes
		for (const [scope, host] of settings.scopes) {
			this.#scopes.set(scope, host);
		}

		// Merge hosts
		for (const [host, auth] of settings.hosts) {
			this.#hosts.set(host, auth);
			auth.token && (auth.token = TokenTools.clean(auth.token));
		}

		// Set default if not already set
		if (settings.default) {
			const { host, auth } = settings.default;
			host && (this.#default.host = settings.default.host);
			auth && (this.#default.auth = auth);
			auth?.token && (this.#default.auth.token = TokenTools.clean(auth.token));
		}
	}

	/**
	 * Load registry data from local, CI, and CDN sources.
	 */
	async load(): Promise<void> {
		const { path, workspace, cdn } = this.#options;

		const local = new LocalLoader();
		path && (await local.load(path, workspace));
		this.#merge(local);

		const vars = new VarsSettingsLoader();
		await vars.load();
		this.#merge(vars);

		const db = new DbSettingsLoader();
		cdn && (await db.load(cdn.credentials));
		this.#merge(db);
	}
}
