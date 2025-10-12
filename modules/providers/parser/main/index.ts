import type { DependencyDataType } from './types';
import { DependencyIsType } from './types';
import { GitInfo } from './git';
import * as semver from 'semver';

/**
 * Resolves and interprets a dependency version specifier declared in a package.json.
 * Determines the data type (semver, git, etc.) and extracts relevant metadata.
 */
export /*bundle*/ class DependencyParser {
	#identifier: string;
	/**
	 * Unique identifier for the dependency
	 *
	 * Examples:
	 * - 'semver:@beyond-js/http'
	 * - 'git:github:user/repo#ref'
	 * - 'url:https://cdn.example.com/pkg.tgz'
	 * - undefined for the rest of types
	 */
	get identifier() {
		return this.#identifier;
	}

	#package: string;
	/**
	 * Full package name as defined in package.json.
	 * Includes scope if applicable (e.g., '@beyond-js/http', 'lodash').
	 */
	get package() {
		return this.#package;
	}

	#scope?: string;
	/**
	 * Optional extracted scope from the package name (with the '@').
	 * For '@beyond-js/http', this would be '@beyond-js'.
	 * Omitted for unscoped packages.
	 */
	get scope() {
		return this.#scope;
	}

	#name?: string;
	/**
	 * Optional extracted name from the package name (without the scope).
	 * For '@beyond-js/http', this would be 'http'.
	 * For 'lodash', this would be 'lodash'.
	 */
	get name() {
		return this.#name;
	}

	#version: string;
	/**
	 * Raw version string as declared in package.json.
	 * Examples:
	 * - '^1.2.0' (semver)
	 * - 'github:user/repo#v1.0.0' (git)
	 * - 'https://cdn.example.com/pkg.tgz' (tarball)
	 */
	get version() {
		return this.#version;
	}

	#data: DependencyDataType;
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
	constructor(pkg: string, version: string) {
		if (!pkg || typeof pkg !== 'string') throw new Error('Invalid package name');

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
			this.#data = { is: DependencyIsType.Undefined };
			return;
		}

		// Semver data (e.g., "^1.0.0", "~2.3.4")
		if (semver.valid(version) || semver.validRange(version)) {
			// Determine if the version is not a specific version
			const range = semver.valid(version) ? false : true;

			this.#identifier = `semver:${pkg}`;
			this.#data = { is: DependencyIsType.Semver, range };
			return;
		}

		// Git data (shorthand or git+ protocol)
		const git = new GitInfo(version);
		if (git) {
			const { error, baseurl, owner, repo, ref } = git;
			if (error) {
				this.#data = { is: DependencyIsType.Error, error };
				return;
			}

			this.#identifier = `git:${baseurl}/${owner}/${repo}${ref ? `#${ref}` : ''}`;
			this.#data = { is: DependencyIsType.Git, baseurl, owner, repo, ref };
			return;
		}

		// Tarball data (e.g., "https://.../mypackage.tgz")
		if (version.endsWith('.tgz') && /^https?:\/\//.test(version)) {
			const parsed = new URL(version);
			const { hostname, pathname } = parsed;
			const file = parsed.pathname.split('/').pop();
			const fname = file.replace(/\.tgz$/, '');

			this.#identifier = `url:${hostname}${pathname}`;
			this.#data = { is: DependencyIsType.Url, hostname, url: version, pathname, file, fname };
			return;
		}

		// Alias data (e.g., "npm:lodash@^4.17.0")
		if (version.startsWith('npm:')) {
			const [, target] = version.split(':');
			this.#data = { is: DependencyIsType.Alias, target };
			return;
		}

		// Fallback: invalid or unsupported version specifier
		this.#data = {
			is: DependencyIsType.Error,
			error: {
				code: 'INVALID_SPECIFIER',
				message: `The version specifier '${version}' is not recognized.`
			}
		};
	}
}
