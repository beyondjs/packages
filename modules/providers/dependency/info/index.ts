import type { DependencyInfoType } from './types';
import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { InfoIsType } from './types';
import { GitInfo } from './git';
import * as semver from 'semver';

/**
 * Resolves and interprets a dependency version specifier declared in a package.json.
 * Determines the data type (semver, git, etc.) and extracts relevant metadata.
 */
export /*bundle*/ class DependencyInfo {
	/**
	 * Full package name as defined in package.json.
	 * Includes scope if applicable (e.g., '@beyond-js/http', 'lodash').
	 */
	#package: string;
	get package() {
		return this.#package;
	}

	/**
	 * Optional extracted scope from the package name (with the '@').
	 * For '@beyond-js/http', this would be '@beyond-js'.
	 * Omitted for unscoped packages.
	 */
	#scope?: string;
	get scope() {
		return this.#scope;
	}

	/**
	 * Optional extracted name from the package name (without the scope).
	 * For '@beyond-js/http', this would be 'http'.
	 * For 'lodash', this would be 'lodash'.
	 */
	#name?: string;
	get name() {
		return this.#name;
	}

	/**
	 * Raw version string as declared in package.json.
	 * Examples:
	 * - '^1.2.0' (semver)
	 * - 'github:user/repo#v1.0.0' (git)
	 * - 'https://cdn.example.com/pkg.tgz' (tarball)
	 */
	#version: string;
	get version() {
		return this.#version;
	}

	#data: DependencyInfoType;
	get data() {
		return this.#data;
	}

	/**
	 * Creates a new DependencyInfo instance by parsing the package name and version specifier.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param version - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @returns
	 */
	constructor(pkg: string, version: string, settings: ProvidersSettings) {
		this.#package = pkg;
		if (pkg.startsWith('@')) {
			const splitted = pkg.split('/');
			this.#scope = splitted[0];
			this.#name = splitted[1];
		} else {
			this.#name = pkg;
		}

		this.#version = version;

		// Undefined or empty version
		if (!version) {
			this.#data = { is: InfoIsType.Undefined, provider: settings.get({ package: pkg }) };
			return;
		}

		// Semver data (e.g., "^1.0.0", "~2.3.4")
		if (semver.valid(version) || semver.validRange(version)) {
			const provider = settings.get({ package: pkg });
			this.#data = { is: InfoIsType.Semver, provider };
			return;
		}

		// Git data (shorthand or git+ protocol)
		const git = new GitInfo(version);
		if (git) {
			const { error, owner, repo, ref } = git;
			if (error) {
				this.#data = { is: InfoIsType.Error, error };
				return;
			}

			const provider = settings.get({ hostname: git.baseurl });
			this.#data = { is: InfoIsType.Git, provider, owner, repo, ref };
			return;
		}

		// Tarball data (e.g., "https://.../mypackage.tgz")
		if (version.endsWith('.tgz') && /^https?:\/\//.test(version)) {
			const parsed = new URL(version);
			const { pathname, hostname } = parsed;
			const file = parsed.pathname.split('/').pop();
			const fname = file.replace(/\.tgz$/, '');

			const provider: IProviderData = settings.get({ hostname });
			this.#data = { is: InfoIsType.Url, provider, url: version, pathname, file, fname };
			return;
		}

		// Alias data (e.g., "npm:lodash@^4.17.0")
		if (version.startsWith('npm:')) {
			const [, target] = version.split(':');
			this.#data = { is: InfoIsType.Alias, target };
			return;
		}

		// Fallback: invalid or unsupported version specifier
		this.#data = {
			is: InfoIsType.Error,
			error: {
				code: 'INVALID_SPECIFIER',
				message: `The version specifier '${version}' is not recognized.`
			}
		};
	}
}
