import type { IProvidersSettings, IProviderData } from '@beyond-js/packages/providers/settings/types';
import type { IProjectData } from '@beyond-js/packages/persistence/types/cdn';
import { def } from '../../default';

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

	async load(project: string): Promise<void> {
		const origin = 'db';
		if (!project) throw new Error('Project ID is required to load CDN provider settings');

		const { projects } = await import('@beyond-js/packages/persistence/cdn/db');
		const response = await projects.data({ id: project });

		// @TODO: handle errors
		if (!response.error) return;
		if (response.data.error || !response.data.exists) return;

		const data: IProjectData = response.data.data;
		const settings = data.providers;

		// Apply default
		if (settings.default) this.#default = { ...settings.default, origin };

		// Apply scopes
		const scopes = settings.scopes || {};
		for (const scope in scopes) {
			this.#scopes.set(scope, { ...scopes[scope], origin });
		}

		// Apply hosts
		const hosts = settings.hosts || {};
		for (const host in hosts || {}) {
			this.#hosts.set(host, { ...hosts[host], origin });
		}
	}
}
