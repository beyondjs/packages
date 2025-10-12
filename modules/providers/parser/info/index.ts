import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import type { DependencyDataType } from '@beyond-js/packages/providers/parser';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { DependencyParser, DependencyIsType } from '@beyond-js/packages/providers/parser';

export /*bundle*/ type DependencyInfoType = DependencyDataType & { provider?: IProviderData };

export /*bundle*/ class DependencyInfo extends DependencyParser {
	get data() {
		const base = this.#provider ? { provider: this.#provider } : {};
		return Object.assign(base, super.data);
	}

	#provider: IProviderData;
	get provider() {
		return this.#provider;
	}

	constructor(pkg: string, version: string, settings: ProvidersSettings) {
		if (!settings) throw new Error('Providers settings instance is required');

		super(pkg, version);

		if (!super.version) {
			this.#provider = settings.get({ package: pkg });
			return;
		}

		if (super.data.is === DependencyIsType.Semver) {
			this.#provider = settings.get({ package: pkg });
			return;
		}

		if (super.data.is === DependencyIsType.Git) {
			this.#provider = settings.get({ hostname: super.data.baseurl });
			return;
		}

		// Tarball data (e.g., "https://.../mypackage.tgz")
		if (super.data.is === DependencyIsType.Url) {
			this.#provider = settings.get({ hostname: super.data.hostname });
			return;
		}

		if (super.data.is === DependencyIsType.Alias) {
			return;
		}
	}
}
