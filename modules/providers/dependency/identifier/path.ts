// PackagePath.ts
import { InfoIsType } from '@beyond-js/packages/providers/dependency/info';
import type { PackageInfoType } from './types';

/**
 * PackagePath builds the canonical storage path for a resolved package.
 * This path is intended for file/object storage (stable and hierarchical).
 *
 * Path formats:
 * - Semver: registry/@scope/name/version
 * - Git:    git/host/owner/repo/commit
 * - URL:    digest/<checksum>
 */
export /*bundle*/ class PackagePath {
	/** Original, already-resolved package info (semver/version, git/commit, url/digest). */
	#info: PackageInfoType;
	get info(): PackageInfoType {
		return this.#info;
	}

	/** Canonical storage path string. */
	#value: string;
	get value(): string {
		return this.#value;
	}

	/** Require a non-empty string field, otherwise throw. */
	#require(value: string | undefined, field: string) {
		value = value?.trim();
		if (typeof value !== 'string' || !value) {
			throw new Error(`PackagePath: missing or empty "${field}"`);
		}
		return value;
	}

	/**
	 * Build a canonical storage path from a strongly-typed PackageInfoType.
	 * @throws Error if the info object is invalid or missing required fields.
	 */
	constructor(info: PackageInfoType) {
		if (!info || !('is' in info)) {
			throw new Error('PackagePath: invalid `info` argument');
		}
		this.#info = info;

		switch (info.is) {
			case InfoIsType.Semver: {
				const hostname = this.#require(info.hostname, 'hostname');
				const pkg = this.#require(info.package, 'package'); // includes scope when present
				const version = this.#require(info.version, 'version');

				// registry/@scope/name/version
				this.#value = `${hostname}/${pkg}/${version}`;
				return;
			}

			case InfoIsType.Git: {
				const host = this.#require(info.hostname, 'hostname');
				const owner = this.#require(info.owner, 'owner');
				const repo = this.#require(info.repo, 'repo');
				const commit = this.#require(info.commit, 'commit');

				// git/host/owner/repo/commit
				this.#value = `git/${host}/${owner}/${repo}/${commit}`;
				return;
			}

			case InfoIsType.Url: {
				const digest = this.#require(info.digest, 'digest');

				// digest/<checksum>
				this.#value = `digest/${digest}`;
				return;
			}

			default:
				throw new Error(`PackagePath: unsupported info type "${String((info as any).is)}"`);
		}
	}
}
