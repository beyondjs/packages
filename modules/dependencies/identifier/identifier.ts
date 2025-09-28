import type { PackageInfoType } from './types';
import { InfoIsType } from '@beyond-js/packages/dependencies/info';

/**
 * PackageIdentifier generates a canonical, immutable identifier (ID)
 * for a resolved package across different origins (semver, git, url).
 *
 * ID formats:
 * - Semver: registry:@scope/name@version
 * - Git:    git:host/owner/repo@commit
 * - URL:    digest:<checksum>
 */
export /*bundle*/ class PackageIdentifier {
	/** Original, already-resolved package info (semver/version, git/commit, url/digest). */
	#info: PackageInfoType;
	get info(): PackageInfoType {
		return this.#info;
	}

	/** Canonical identifier string. */
	#value: string;
	get value(): string {
		return this.#value;
	}

	/** Require a non-empty string field, otherwise throw. */
	#require(value: string | undefined, field: string) {
		value = value?.trim();
		if (typeof value !== 'string' || !value) {
			throw new Error(`PackageIdentifier: missing or empty "${field}"`);
		}
		return value;
	}

	/**
	 * Build a canonical identifier from a strongly-typed PackageInfoType.
	 * @throws Error if the info object is invalid or missing required fields.
	 */
	constructor(info: PackageInfoType) {
		if (!info || !('is' in info)) {
			throw new Error('PackageIdentifier: invalid `info` argument');
		}
		this.#info = info;

		switch (info.is) {
			case InfoIsType.Semver: {
				const { hostname, package: pkg, version } = info;
				// registry:@scope/name@version
				this.#value = `${hostname}:${pkg}@${version}`;
				return;
			}

			case InfoIsType.Git: {
				const hostname = this.#require(info.hostname, 'hostname');
				const owner = this.#require(info.owner, 'owner');
				const repo = this.#require(info.repo, 'repo');
				const commit = this.#require(info.commit, 'commit');

				// git:host/owner/repo@commit
				this.#value = `git:${hostname}/${owner}/${repo}@${commit}`;
				return;
			}

			case InfoIsType.Url: {
				const digest = this.#require(info.digest, 'digest');

				// digest:<checksum>
				this.#value = `digest:${digest}`;
				return;
			}

			default:
				throw new Error(`PackageIdentifier: unsupported info type "${String((info as any).is)}"`);
		}
	}
}
