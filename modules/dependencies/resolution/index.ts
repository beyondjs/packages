import type { IGitIdentifier, IPackageResolution, RepositoryType } from '@beyond-js/packages/repositories/types';
import { PackageResolutionType } from '@beyond-js/packages/repositories/types';
import { Semver } from './semver';
import { GitParser } from './git';

/**
 * Resolves and interprets a dependency version specifier declared in a package.json.
 * Determines the resolution type (semver, tarball, git, etc.) and extracts relevant metadata.
 */
export /*bundle*/ class DependencyResolution implements IPackageResolution {
	// 'semver', 'git', 'url', 'unknown'
	#is?: PackageResolutionType;
	get is() {
		return this.#is;
	}

	// Repository type: 'default', 'npm', 'github', 'github-pkg', etc.
	#type: RepositoryType;
	get type() {
		return this.#type;
	}

	// The package name (with scope if applicable)
	#package: string;
	get package() {
		return this.#package;
	}

	// Extracted scope (if any, with the '@')
	#scope?: string;
	get scope() {
		return this.#scope;
	}

	// The raw version specifier as declared in package.json
	#version: string;
	get version() {
		return this.#version;
	}

	#git?: IGitIdentifier;
	get git() {
		return this.#git;
	}

	#error?: { code: string; text: string };
	get error() {
		return this.#error;
	}

	/**
	 * Creates a new DependencyResolution instance by parsing the package name and version specifier.
	 *
	 * @param pkg The full package name as declared in package.json (with scope if applicable)
	 * @param version The version specifier as declared in package.json
	 * @returns
	 */
	constructor(pkg: string, version: string) {
		this.#package = pkg;
		this.#version = version;

		// Alias resolution (e.g., "npm:lodash@^4.17.0")
		if (version.startsWith('npm:')) {
			const [, target] = version.split(':');
			const [, aliasVersion] = target.split('@');
			this.#is = PackageResolutionType.Semver;
			this.#repository = 'default';
			this.#semver = aliasVersion || '*';
			return;
		}

		// Tarball resolution (e.g., "https://.../mypackage.tgz")
		if (version.endsWith('.tgz') && /^https?:\/\//.test(version)) {
			this.#is = PackageResolutionType.Url;
			return;
		}

		// Git resolution (shorthand or git+ protocol)
		const parsed = GitParser.parse(version);
		if (parsed) {
			this.#is = PackageResolutionType.Git;
			this.#git = {
				host: parsed.host,
				owner: parsed.owner,
				repo: parsed.repo,
				ref: parsed.ref
			};
			this.#repository = parsed.repository;
			return;
		}

		// Semver resolution (e.g., "^1.0.0", "~2.3.4")
		if (Semver.is(version)) {
			this.#is = PackageResolutionType.Semver;
			this.#semver = version;
			this.#repository = 'default';

			if (name.startsWith('@')) {
				const [scope, pkg] = name.slice(1).split('/');
				this.#scope = scope;
				this.#name = pkg;
			}
			return;
		}

		// Fallback: invalid or unsupported version specifier
		this.#is = PackageResolutionType.Unknown;
		this.#error = {
			code: 'INVALID_SPECIFIER',
			text: `The version specifier '${version}' is not recognized.`
		};
	}
}
