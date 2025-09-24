import { exec } from 'child_process';
import { platform } from 'os';
import { ErrorGettingPackageVersions } from '@beyond-js/packages/providers/errors';

interface ICliVersionsResponse {
	versions?: string[];
	error?: ErrorGettingPackageVersions;
}

/**
 * CLI helper for npmjs.org.
 * Provides a fast way to get the versions list without fetching the full packument.
 */
export class Cli {
	/**
	 * Get available versions of a package using `npm view <pkg> versions --json`.
	 * @param pkg Package name (scoped or unscoped)
	 */
	static versions(pkg: string): Promise<ICliVersionsResponse> {
		return new Promise(resolve => {
			try {
				const nullDevice = platform() === 'win32' ? 'NUL' : '/dev/null';
				exec(`npm view ${pkg} versions --json 2>${nullDevice}`, (error, stdout) => {
					if (error) {
						resolve({ error: new ErrorGettingPackageVersions(error) });
						return;
					}

					const parsed = JSON.parse(stdout);
					const versions = typeof parsed === 'string' ? [parsed] : parsed;

					resolve({ versions });
				});
			} catch (exc) {
				const error = new ErrorGettingPackageVersions(exc);
				resolve({ error });
			}
		});
	}
}
