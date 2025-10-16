import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import type { DependencySourceType } from '@beyond-js/packages/dependency-source';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';

export /*bundle*/ type DependencyInfoType = DependencySourceType & { provider?: IProviderData };

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

		this.#source = source;

		if (source.data.is === DependencySourceIsType.Semver) {
			const { package: pkg } = source;
			this.#provider = settings.get({ package: pkg });
			return;
		}

		if (source.data.is === DependencySourceIsType.Git) {
			this.#provider = settings.get({ hostname: source.data.baseurl });
			return;
		}

		// Tarball data (e.g., "https://.../mypackage.tgz")
		if (source.data.is === DependencySourceIsType.Url) {
			this.#provider = settings.get({ hostname: source.data.hostname });
			return;
		}

		if (source.data.is === DependencySourceIsType.Alias) {
			return;
		}
	}
}
