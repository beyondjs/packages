import type { DependencyInfoType } from './types';
import { InfoIsType } from './types';
import * as semver from 'semver';
import { GitInfo } from './git';

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
	 * @param pkg The full package name as declared in package.json (with scope if applicable)
	 * @param version The version specifier as declared in package.json
	 * @returns
	 */
	constructor(pkg: string, version: string) {
		this.#package = pkg;
		this.#scope = pkg.startsWith('@') ? pkg.split('/')[0] : void 0;
		this.#version = version;

		// Semver data (e.g., "^1.0.0", "~2.3.4")
		if (semver.valid(version) || semver.validRange(version)) {
			this.#data = { is: InfoIsType.Semver };
			return;
		}

		// Git data (shorthand or git+ protocol)
		const git = new GitInfo(version);
		if (git) {
			this.#data = { is: InfoIsType.Git, git };
			return;
		}

		// Tarball data (e.g., "https://.../mypackage.tgz")
		if (version.endsWith('.tgz') && /^https?:\/\//.test(version)) {
			const parsed = new URL(version);
			const { pathname, hostname } = parsed;
			const file = parsed.pathname.split('/').pop();
			const fname = file.replace(/\.tgz$/, '');

			this.#data = { is: InfoIsType.Url, url: version, file, fname, pathname, hostname };
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
