import type { IRegistry, IPackageSpecResponse } from './types';
import type { RepositoryType, IRepositoryAuth } from '@beyond-js/packages/repositories/types';
import type { Logger } from '@beyond-js/packages/logs';
import { RepositoriesSettings } from '@beyond-js/packages/repositories/settings';
import { ErrorGettingPackageVersions } from '@beyond-js/packages/repositories/errors';
import { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import { exec } from 'child_process';
import { platform } from 'os';
import { PackageRegistryFetcher } from './fetcher';
import { AuthHeaders } from './tools';

const nullDevice = platform() === 'win32' ? 'NUL' : '/dev/null';

export /*bundle*/ class NPM implements IRegistry {
	#settings: RepositoriesSettings;

	readonly #name = 'npm';
	get name(): string {
		return this.#name;
	}

	readonly #type: RepositoryType = 'npm';
	get type(): RepositoryType {
		return this.#type;
	}

	readonly #host = 'registry.npmjs.org';
	get host(): string {
		return this.#host;
	}
	get url(): string {
		return `https://${this.#host}`;
	}

	constructor(settings: RepositoriesSettings) {
		this.#settings = settings;
	}

	/**
	 * Returns the authentication details for the registry.
	 */
	auth(): IRepositoryAuth {
		return this.#settings.hosts.get(this.host);
	}

	/**
	 * Returns the headers to be used for requests to this registry.
	 */
	headers(): Record<string, string> {
		const auth = this.auth();
		return auth ? AuthHeaders.process(auth) : {};
	}

	tarball(scope: string, name: string): string {
		const prefix = scope ? `${scope}/` : '';
		return `https://${this.host}/${prefix}${name}/-/${name}.tgz`;
	}

	versions(name: string, logger?: Logger): Promise<RepositoriesResponse<string[]>> {
		return new Promise(resolve => {
			try {
				exec(`npm view ${name} versions --json 2>${nullDevice}`, (error, stdout) => {
					if (error) {
						resolve(new RepositoriesResponse({ error: new ErrorGettingPackageVersions(error) }));
						return;
					}

					const parsed = JSON.parse(stdout);
					const data = typeof parsed === 'string' ? [parsed] : parsed;

					resolve(new RepositoriesResponse({ data }));
				});
			} catch (exc) {
				const error = new ErrorGettingPackageVersions(exc);
				resolve(new RepositoriesResponse({ error }));
			}
		});
	}

	async spec(name: string, version: string, logger?: Logger): Promise<RepositoriesResponse<IPackageSpecResponse>> {
		const response = await PackageRegistryFetcher.spec(this.url, name, version, logger);

		if (response.error) {
			return new RepositoriesResponse({ error: response.error });
		} else {
			return new RepositoriesResponse({ data: response });
		}
	}
}
