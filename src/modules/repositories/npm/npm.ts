import { ErrorGettingPackageVersions } from '@beyond-js/packages/repositories/errors';
import { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import { exec } from 'child_process';
import { platform } from 'os';
import type { ISpecsResponse } from './fetcher';
import { PackageRegistryFetcher } from './fetcher';

const nullDevice = platform() === 'win32' ? 'NUL' : '/dev/null';

export /*bundle*/ interface IPackageJson {
	name: string;
	version: string;
	dependencies?: { [key: string]: string };
	devDependencies?: { [key: string]: string };
	peerDependencies?: { [key: string]: string };
}

export /*bundle*/ class NPM {
	static versions(name: string): Promise<RepositoriesResponse<string[]>> {
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

	static async specs(name: string, version: string): Promise<ISpecsResponse> {
		const fetcher = new PackageRegistryFetcher(name, version);
		await fetcher.fetch();
		return fetcher.toJSON();
	}
}
