import type { DependencyInfo } from '@beyond-js/packages/dependencies/info';
import { InfoIsType } from '@beyond-js/packages/dependencies/info';

export /*bundle*/ class PackageIdentifier {
	#info: DependencyInfo;
	get info() {
		return this.#info;
	}

	/**
	 * The version string that uniquely identifies the resolved package.
	 * This is the specific version for semver, the specific commit hash for git, or the digest for url.
	 */
	#resolved: string;
	get resolved() {
		return this.#resolved;
	}

	#error?: { code: string; message: string };
	get error() {
		return this.#error;
	}

	// The id is used to uniquely identify a package version across different registries
	// Used for caching and storage
	readonly #id: string;
	get id() {
		return this.#id;
	}

	// The path is used for storage paths, to store package contents
	readonly #path: string;
	get path() {
		return this.#path;
	}

	constructor(info: DependencyInfo, resolved?: string) {
		this.#info = info;

		/**
		 * The resolved version string uniquely identifying the package version.
		 *
		 * For semver, this is the specific version (e.g., '1.2.3').
		 * For git, this is the specific commit hash (e.g., 'a1b2c3d4').
		 * For url, this is the content digest (e.g., 'abcdef1234567890').
		 * If not provided, defaults to the original version specifier.
		 */
		this.#resolved = resolved;

		if (info.data.is === InfoIsType.Error) return;

		if (info.data.is === InfoIsType.Semver) {
			const { package: name, scope } = info;

			const { hostname } = info.data;
			const repository = hostname.replace(/^https?:\/\//, '').replace(/\/+$/, '');

			// ID format: [repository]:[@scope/]name@version
			// Path format: repository/[@scope/]name/version
			this.#id = scope ? `${repository}:${scope}/${name}@${resolved}` : `${repository}/${name}@${resolved}`;
			this.#path = scope ? `${repository}/${scope}/${name}/${resolved}` : `${repository}/${name}/${resolved}`;
		} else if (info.data.is === InfoIsType.Git) {
			const { hostname, owner, repo } = info.data;

			this.#id = `git:${hostname}/${owner}/${repo}@${resolved}`;
			this.#path = `git/${hostname}/${owner}/${repo}/${resolved}`;
		} else if (info.data.is === InfoIsType.Url) {
			const { fname, hostname } = info.data;

			this.#id = `tarball:${hostname}/${fname}`;
			this.#path = `tarball/${hostname}/${fname}`;
		} else {
			this.#error = {
				code: 'INVALID_IDENTIFIER',
				message: `Invalid package identifier: ${JSON.stringify(info.data.is)}`
			};
		}
	}
}
