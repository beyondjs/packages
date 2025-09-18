import type { DependencyResolutionType } from './types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { ResolutionIsType } from './types';
import { Semver } from './semver';
import { GitProvider } from './git';

/**
 * Resolves and interprets a dependency version specifier declared in a package.json.
 * Determines the resolution type (semver, git, etc.) and extracts relevant metadata.
 */
export /*bundle*/ class DependencyResolution {
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

	#resolution: DependencyResolutionType;
	get resolution() {
		return this.#resolution;
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
		this.#scope = pkg.startsWith('@') ? pkg.split('/')[0] : void 0;
		this.#version = version;

		// Semver resolution (e.g., "^1.0.0", "~2.3.4")
		if (Semver.is(version)) {
			this.#resolution = { is: ResolutionIsType.Semver };
			return;
		}

		// Git resolution (shorthand or git+ protocol)
		const git = new GitProvider(version);
		if (git) {
			this.#resolution = { is: ResolutionIsType.Git, git };
			return;
		}

		// Tarball resolution (e.g., "https://.../mypackage.tgz")
		if (version.endsWith('.tgz') && /^https?:\/\//.test(version)) {
			this.#resolution = { is: ResolutionIsType.Url, url: version };
			return;
		}

		// Alias resolution (e.g., "npm:lodash@^4.17.0")
		if (version.startsWith('npm:')) {
			const [, target] = version.split(':');
			this.#resolution = { is: ResolutionIsType.Alias, target };
			return;
		}

		// Fallback: invalid or unsupported version specifier
		this.#resolution = {
			is: ResolutionIsType.Error,
			error: {
				code: 'INVALID_SPECIFIER',
				message: `The version specifier '${version}' is not recognized.`
			}
		};
	}
}
