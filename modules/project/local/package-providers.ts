import type { Project } from './';
import type { IPackageManifest } from '@beyond-js/packages/types';
import { Providers } from '@beyond-js/packages/providers';
import { db } from '@beyond-js/packages/persistence/db';

export class PackageProviders {
	#providers: Providers;

	constructor(project: Project) {
		const { workspace, path } = project;
		this.#providers = new Providers({ workspace, path });
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @param version - The specific version to retrieve.
	 */
	async manifest(pkg: string, specifier: string, version: string): Promise<IPackageManifest> {}
}
