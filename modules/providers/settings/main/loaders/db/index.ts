import type { IProjectData } from '@beyond-js/packages/persistence/types/cdn';
import { Layer } from '../../layer';

/**
 * Firestore-based repository settings loader.
 */
export class DbSettingsLoader {
	#layer = new Layer('db');
	get layer() {
		return this.#layer;
	}

	#error?: { code: string; message: string };
	/**
	 * Set when the stored settings could not be read: the layer is then empty
	 */
	get error() {
		return this.#error;
	}

	async load(project: string): Promise<void> {
		if (!project) throw new Error('Project ID is required to load CDN provider settings');
		const layer = (this.#layer = new Layer('db'));
		this.#error = void 0;

		const { projects } = await import('@beyond-js/packages/persistence/cdn/db');
		const response = await projects.data({ id: project });

		// The nominal path continues: this guard used to return when there was NO error
		if (response.error) {
			this.#error = { code: 'PROVIDER_SETTINGS_UNAVAILABLE', message: 'Stored provider settings failed to load' };
			return;
		}
		if (response.data.error || !response.data.exists) return;

		const data: IProjectData = response.data.data;
		const settings: any = data.providers;
		if (!settings) return;

		if (settings.default) {
			settings.default.base && layer.default(settings.default.base);
			settings.default.auth && layer.credentials(settings.default.auth);
		}

		const scopes = settings.scopes || {};
		for (const scope of Object.keys(scopes)) {
			const { base, auth } = scopes[scope];
			if (!base) continue;
			layer.scope(scope, base);
			auth && auth.mode !== 'none' && layer.host(base, auth);
		}

		const hosts = settings.hosts || {};
		for (const host of Object.keys(hosts)) {
			const { base, auth } = hosts[host];
			auth && auth.mode !== 'none' && layer.host(base || host, auth);
		}
	}
}
