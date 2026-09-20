import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import {
	type DependencySourceType,
	type DependencySource,
	DependencySourceIsType
} from '@beyond-js/packages/dependency-source';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';

export /*bundle*/ type DependencyInfoType = DependencySourceType & { provider?: IProviderData };

/**
 * Selects the provider (registry or host, with its authentication) that serves a dependency source.
 * An alias is served by the provider of the package it targets.
 */
export /*bundle*/ class DependencySourceProvider {
	#source: DependencySource;
	get source() {
		return this.#source;
	}

	#provider: IProviderData;
	get provider() {
		return this.#provider;
	}

	constructor(source: DependencySource, settings: ProvidersSettings) {
		if (!settings) throw new Error('Providers settings instance is required');

		// The identity of an alias is its target: requests and records never use the declared alias name
		source = source.target;
		this.#source = source;

		if (source.data.is === DependencySourceIsType.Semver) {
			const { package: pkg } = source;
			this.#provider = settings.get({ package: pkg });
			return;
		}

		if (source.data.is === DependencySourceIsType.Git) {
			this.#provider = settings.get({ hostname: source.data.baseurl, base: source.data.base });
			return;
		}

		// Tarball data (e.g., "https://.../mypackage.tgz")
		if (source.data.is === DependencySourceIsType.Url) {
			const base = new URL(source.data.url).origin;
			this.#provider = settings.get({ hostname: source.data.hostname, base });
			return;
		}
	}
}
