import type { Logger } from '@beyond-js/packages/logs';
import { exec } from 'child_process';
import { platform } from 'os';
import { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import { ErrorGettingPackageVersions } from '@beyond-js/packages/repositories/errors';

/**
 * CLI helper for npmjs.org.
 * Provides a fast way to get the versions list without fetching the full packument.
 */
export class Cli {
	/**
	 * Get available versions of a package using `npm view <pkg> versions --json`.
	 * @param pkg Package name (scoped or unscoped)
	 */
	static versions(pkg: string, logger?: Logger): Promise<RepositoriesResponse<string[]>> {
		return new Promise(resolve => {
			try {
				const nullDevice = platform() === 'win32' ? 'NUL' : '/dev/null';
				exec(`npm view ${pkg} versions --json 2>${nullDevice}`, (error, stdout) => {
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
}
