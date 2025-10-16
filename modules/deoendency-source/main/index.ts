import type { DependencySourceType } from './types';
import { DependencySourceIsType } from './types';
import { GitInfo } from './git';
import * as semver from 'semver';

/**
 * Resolves and interprets a dependency version specifier declared in a package.json.
 * Determines the source type (semver, git, etc.) and extracts relevant metadata.
 */
export /*bundle*/ class DependencySource {
	#id: string;
	/**
	 * Unique id for the dependency
	 *
	 * Examples:
	 * - 'semver:@beyond-js/http'
	 * - 'git:github:user/repo#ref'
	 * - 'url:https://cdn.example.com/pkg.tgz'
	 * - undefined for the rest of sources
	 */
	get id() {
		return this.#id;
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

	#spec: string;
	/**
	 * Raw version string as declared in package.json.
	 * Examples:
	 * - '^1.2.0' (semver)
	 * - 'github:user/repo#v1.0.0' (git)
	 * - 'https://cdn.example.com/pkg.tgz' (tarball)
	 */
	get spec() {
		return this.#spec;
	}

	#data: DependencySourceType;
	get data() {
		return this.#data;
	}

	/**
	 * Creates a new DependencyInfo instance by parsing the package name and version specifier.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param spec - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @returns
	 */
	constructor(pkg: string, spec: string) {
		if (!pkg || typeof pkg !== 'string') throw new Error('Invalid package name');

		this.#package = pkg;
		if (pkg.startsWith('@')) {
			const splitted = pkg.split('/');
			this.#scope = splitted[0];
			this.#name = splitted[1];
		} else {
			this.#name = pkg;
		}

		this.#spec = spec;

		// Undefined or empty spec
		if (!spec) throw new Error('Dependency specificaction cannot be undefined');

		// Semver source (e.g., "^1.0.0", "~2.3.4")
		if (semver.valid(spec) || semver.validRange(spec)) {
			// Determine if the version is not a specific version
			const range = semver.valid(spec) ? false : true;

			this.#id = `semver:${pkg}`;
			this.#data = { is: DependencySourceIsType.Semver, range };
			return;
		}

		// Git source (shorthand or git+ protocol)
		const git = new GitInfo(spec);
		if (git) {
			const { error, baseurl, owner, repo, ref } = git;
			if (error) {
				this.#data = { is: DependencySourceIsType.Error, error };
				return;
			}

			this.#id = `git:${baseurl}/${owner}/${repo}${ref ? `#${ref}` : ''}`;
			this.#data = { is: DependencySourceIsType.Git, baseurl, owner, repo, ref };
			return;
		}

		// Tarball source (e.g., "https://.../mypackage.tgz")
		if (spec.endsWith('.tgz') && /^https?:\/\//.test(spec)) {
			const parsed = new URL(spec);
			const { hostname, pathname } = parsed;
			const file = parsed.pathname.split('/').pop();
			const fname = file.replace(/\.tgz$/, '');

			this.#id = `url:${hostname}${pathname}`;
			this.#data = { is: DependencySourceIsType.Url, hostname, url: spec, pathname, file, fname };
			return;
		}

		// Alias source (e.g., "npm:lodash@^4.17.0")
		if (spec.startsWith('npm:')) {
			const [, target] = spec.split(':');
			this.#data = { is: DependencySourceIsType.Alias, target };
			return;
		}

		// Fallback: invalid or unsupported version specifier
		this.#data = {
			is: DependencySourceIsType.Error,
			error: {
				code: 'INVALID_SPECIFIER',
				message: `The version specifier '${spec}' is not recognized.`
			}
		};
	}
}
