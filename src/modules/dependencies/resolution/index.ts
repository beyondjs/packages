import type { IPackageResolution, RepositoryType } from '@beyond-js/packages/repositories/types';
import { PackageResolutionType } from '@beyond-js/packages/repositories/types';
import { Semver } from './semver';
import { GitParser } from './git';

/**
 * Resolves and interprets a dependency version specifier declared in a package.json.
 * Determines the resolution type (semver, tarball, git, etc.) and extracts relevant metadata.
 */
export /*bundle*/ class PackageResolution implements IPackageResolution {
	#name: string;
	get name() {
		return this.#name;
	}

	#scope?: string;
	get scope() {
		return this.#scope;
	}

	#version: string;
	get version() {
		return this.#version;
	}

	#resolution?: PackageResolutionType;
	get resolution() {
		return this.#resolution;
	}

	#semver?: string;
	get semver() {
		return this.#semver;
	}

	#repository?: RepositoryType;
	get repository() {
		return this.#repository;
	}

	#git?: { host: string; owner: string; repo: string; ref?: string };
	get git() {
		return this.#git;
	}

	#error?: { code: string; text: string };
	get error() {
		return this.#error;
	}

	constructor(name: string, version: string) {
		this.#name = name;
		this.#version = version;

		// Alias resolution (e.g., "npm:lodash@^4.17.0")
		if (version.startsWith('npm:')) {
			const [, target] = version.split(':');
			const [, aliasVersion] = target.split('@');
			this.#resolution = PackageResolutionType.Semver;
			this.#repository = 'default';
			this.#semver = aliasVersion || '*';
			return;
		}

		// Tarball resolution (e.g., "https://.../mypackage.tgz")
		if (version.endsWith('.tgz') && /^https?:\/\//.test(version)) {
			this.#resolution = PackageResolutionType.Url;
			return;
		}

		// Git resolution (shorthand or git+ protocol)
		const parsed = GitParser.parse(version);
		if (parsed) {
			this.#resolution = PackageResolutionType.Git;
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
			this.#resolution = PackageResolutionType.Semver;
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
		this.#resolution = PackageResolutionType.Unknown;
		this.#error = {
			code: 'INVALID_SPECIFIER',
			text: `The version specifier '${version}' is not recognized.`
		};
	}
}
