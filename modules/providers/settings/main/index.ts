import type { IProvidersSettings, IProviderData } from '@beyond-js/packages/providers/settings/types';
import { def } from './default';

// Import the loaders
import { LocalLoader } from './loaders/local';
import { VarsSettingsLoader } from './loaders/vars';
import { DbSettingsLoader, type CdnCredentials } from './loaders/db';

export /*bundle*/ interface IProvidersSettingsOptions {
	path?: string; // Optional context path for local settings
	workspace?: string; // Optional workspace for local settings
	cdn?: {
		credentials: CdnCredentials; // Credentials for CDN-based settings
	};
}

export /*bundle*/ class ProvidersSettings implements IProvidersSettings {
	#options: IProvidersSettingsOptions;
	get options() {
		return this.#options;
	}

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

	constructor(options: IProvidersSettingsOptions = {}) {
		this.#options = options;
	}

	get({ package: pkg, scope, hostname }: { package?: string; scope?: string; hostname?: string }): IProviderData {
		// If hostname is provided, return its provider if exists, otherwise return a default unregistered provider
		if (hostname) {
			if (this.#hosts.has(hostname)) return this.#hosts.get(hostname);
			const origin = 'unregistered';
			const base = `https://${hostname}`;
			return { origin, base, hostname, auth: { mode: 'none' } };
		}

		// Check package first
		if (pkg) {
			const scope = pkg.split('/')[0];
			if (this.#scopes.has(scope)) {
				return this.#scopes.get(scope);
			}
		}

		// Check scope first
		if (scope && this.#scopes.has(scope)) {
			return this.#scopes.get(scope);
		}

		// Return default
		return this.#default;
	}

	#merge(settings: IProvidersSettings) {
		// Set default if not already set
		if (settings.default) this.#default = settings.default;

		// Merge scopes
		for (const [scope, provider] of settings.scopes) {
			this.#scopes.set(scope, provider);
		}

		// Merge hosts
		for (const [host, provider] of settings.hosts) {
			this.#hosts.set(host, provider);
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
