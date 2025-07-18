// sources/cdn.ts

import { Resolver } from '../index';
import type { Registry } from '../types';

/**
 * Loads registry and scope configurations from a remote CDN (e.g. Firestore).
 * This is used as a fallback when local and CI environments are not available.
 *
 * The data is expected to come from the Firestore collection:
 *   Accounts/Projects/[project]/Registries
 *
 * Example structure (for each registry document):
 * {
 *   host: 'my.registry.com',
 *   source: 'custom',
 *   auth: {
 *     type: 'token',
 *     token: '...',
 *     headers: { ... }
 *   },
 *   origin: 'cdn'
 * }
 */
export class CDNLoader extends Resolver {
	async process(): Promise<void> {
		// TODO: Fetch data from Firestore and populate this.registries and this.scopes
		/*
		const registries: Registry[] = await fetchFromFirestore(...);
		for (const registry of registries) {
			this.registries.set(registry.host, registry);
		}

		const scopes: [string, string][] = await fetchScopesFromFirestore(...);
		for (const [scope, host] of scopes) {
			this.scopes.set(scope, host);
		}

		const settings: [string, string][] = await fetchSettingsFromFirestore(...);
		for (const [key, value] of settings) {
			this.settings.set(key, value);
		}
		*/
	}
}
