import type { IRepository, IPackageSpecResponse, RepositoryType } from '@beyond-js/packages/repositories/types';
import type { Logger } from '@beyond-js/packages/logs';
import { ErrorGettingPackageVersions } from '@beyond-js/packages/repositories/errors';
import { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import { exec } from 'child_process';
import { platform } from 'os';
import { PackageRegistryFetcher } from './fetcher';

const nullDevice = platform() === 'win32' ? 'NUL' : '/dev/null';

export /*bundle*/ class NPM implements IRepository {
	#logger?: Logger;

	constructor(logger: Logger) {
		this.#logger = logger;

		this.#logger?.debug('NPM repository initialized');
		this.#logger?.debug(`Using null device: ${nullDevice}`);
		this.#logger?.debug(`Platform: ${platform()}`);
	}

	readonly #name = 'npm';
	get name(): string {
		return this.#name;
	}

	readonly #type: RepositoryType = 'npm';
	get type(): RepositoryType {
		return this.#type;
	}

	readonly #url = 'https://registry.npmjs.org';
	get url(): string {
		return this.#url;
	}

	versions(name: string): Promise<RepositoriesResponse<string[]>> {
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

	async spec(name: string, version: string): Promise<IPackageSpecResponse> {
		const fetcher = new PackageRegistryFetcher(name, version, this.#logger);
		await fetcher.fetch();
		return fetcher.json();
	}
}
