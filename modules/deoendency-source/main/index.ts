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
	 * - 'url:cdn.example.com/pkg.tgz'
	 * - the id of the aliased package for an alias ('npm:lodash@^4' is 'semver:lodash')
	 * - undefined for unrecognized specifiers
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

	#target?: DependencySource;
	/**
	 * The source that identifies the package actually resolved: the aliased package of an alias
	 * ("npm:lodash@^4"), and this same source otherwise. The alias keeps the declared name in `package`.
	 */
	get target(): DependencySource {
		return this.#target || this;
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

		// Undefined spec is a programming error; an empty one means any version, as package managers read it
		if (spec === void 0 || spec === null) throw new Error('Dependency specificaction cannot be undefined');
		if (spec === '') spec = '*';
		this.#spec = spec;

		// Semver source (e.g., "^1.0.0", "~2.3.4")
		if (semver.valid(spec) || semver.validRange(spec)) {
			// Determine if the version is not a specific version
			const range = semver.valid(spec) ? false : true;

			this.#id = `semver:${pkg}`;
			this.#data = { is: DependencySourceIsType.Semver, range };
			return;
		}

		// Git source (shorthand or git+ protocol). An unmatched specifier yields no info: never test the
		// instance itself, which is always truthy
		const git = GitInfo.parse(spec);
		if (git) {
			const { error, baseurl, base, owner, repo, ref, pinned } = git;
			if (error) {
				this.#data = { is: DependencySourceIsType.Error, error };
				return;
			}

			this.#id = `git:${baseurl}/${owner}/${repo}${ref ? `#${ref}` : ''}`;
			this.#data = { is: DependencySourceIsType.Git, baseurl, base, owner, repo, ref, pinned };
			return;
		}

		// Tarball source (e.g., "https://.../mypackage.tgz#sha512-…")
		if (/^https?:\/\//.test(spec)) {
			let parsed: URL;
			try {
				parsed = new URL(spec);
			} catch {
				parsed = void 0;
			}

			if (parsed && /\.(tgz|tar\.gz)$/.test(parsed.pathname)) {
				const { host, pathname } = parsed;
				const file = pathname.split('/').pop();
				const fname = file.replace(/\.(tgz|tar\.gz)$/, '');
				const integrity = parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : undefined;
				parsed.hash = '';

				// Credentials embedded in a URL never become part of an identity or of a stored URL
				parsed.username = '';
				parsed.password = '';

				const hostname = host.toLowerCase();
				this.#id = `url:${hostname}${pathname}`;
				this.#data = {
					is: DependencySourceIsType.Url,
					hostname,
					url: parsed.href,
					pathname,
					file,
					fname,
					integrity
				};
				return;
			}
		}

		// Alias source (e.g., "npm:lodash@^4.17.0"): the identity is the one of the target package
		if (spec.startsWith('npm:')) {
			const value = spec.slice('npm:'.length);
			const at = value.lastIndexOf('@');
			const name = at > 0 ? value.slice(0, at) : value;
			const range = at > 0 ? value.slice(at + 1) : '*';

			let target: DependencySource;
			try {
				target = new DependencySource(name, range);
			} catch {
				target = void 0;
			}

			if (target && target.data.is === DependencySourceIsType.Semver) {
				this.#target = target;
				this.#id = target.id;
				this.#data = { is: DependencySourceIsType.Alias, target: name, spec: range };
				return;
			}
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
