import type { PackageInfoType } from './types';
import { DependencyIsType } from '@beyond-js/packages/providers/parser';

/**
 * PackageIdentifier builds an id for a resolved package (semver, git, url)
 * and can also hydrate from that id string.
 *
 * Id forms:
 * - registry:@scope/name@version
 * - git:host/owner/repo@commit
 * - digest:<checksum>
 */
export /*bundle*/ class PackageIdentifier {
	/** Resolved info (semver, git, url). */
	#info: PackageInfoType;
	get info(): PackageInfoType {
		return this.#info;
	}

	/** Id string. */
	#value: string;
	get value(): string {
		return this.#value;
	}

	/** Need a non empty string field. */
	#need(v: string | undefined, field: string) {
		v = v?.trim();
		if (typeof v !== 'string' || !v) {
			throw new Error(`PackageIdentifier: missing or empty "${field}"`);
		}
		return v;
	}

	/**
	 * Make from info or hydrate from id.
	 */
	constructor(src: PackageInfoType | string) {
		if (typeof src === 'string') {
			const info = PackageIdentifier.parse(src);
			this.#info = info;
			this.#value = PackageIdentifier.#build(info);
			return;
		}

		if (!src || !('is' in src)) {
			throw new Error('PackageIdentifier: invalid info');
		}

		this.#info = src;
		this.#value = PackageIdentifier.#build(src);
	}

	/**
	 * Build id from info.
	 */
	static #build(info: PackageInfoType): string {
		switch (info.is) {
			case DependencyIsType.Semver: {
				// expect: hostname, package, version
				const host = (info as any).hostname ?? 'registry';
				const pkg = (info as any).package;
				const ver = (info as any).version;
				if (!host || !pkg || !ver) {
					throw new Error('PackageIdentifier: semver needs hostname, package, version');
				}
				return `${host}:${pkg}@${ver}`;
			}

			case DependencyIsType.Git: {
				const host = (info as any).hostname;
				const owner = (info as any).owner;
				const repo = (info as any).repo;
				const commit = (info as any).commit;
				if (!host || !owner || !repo || !commit) {
					throw new Error('PackageIdentifier: git needs hostname, owner, repo, commit');
				}
				return `git:${host}/${owner}/${repo}@${commit}`;
			}

			case DependencyIsType.Url: {
				const digest = (info as any).digest;
				if (!digest) {
					throw new Error('PackageIdentifier: url needs digest');
				}
				return `digest:${digest}`;
			}

			default:
				throw new Error(`PackageIdentifier: bad info type "${String((info as any).is)}"`);
		}
	}

	/**
	 * Parse an id back to info.
	 * - registry:@scope/name@1.2.3
	 * - git:host/owner/repo@deadbeef
	 * - digest:sha256-xxxx
	 */
	static parse(id: string): PackageInfoType {
		const s = id?.trim();
		if (!s) throw new Error('PackageIdentifier.parse: empty id');

		// git
		if (s.startsWith('git:')) {
			const m = /^git:([^/]+)\/([^/]+)\/([^@]+)@(.+)$/.exec(s);
			if (!m) throw new Error(`PackageIdentifier.parse: bad git id "${s}"`);
			const [, hostname, owner, repo, commit] = m;
			return {
				is: DependencyIsType.Git,
				hostname,
				owner,
				repo,
				commit
			} as PackageInfoType;
		}

		// digest
		if (s.startsWith('digest:')) {
			const digest = s.slice(7);
			if (!digest) throw new Error(`PackageIdentifier.parse: bad digest id "${s}"`);
			return {
				is: DependencyIsType.Url,
				digest
			} as PackageInfoType;
		}

		// semver like: <host>:<pkg>@<ver>
		const sm = /^([^:]+):(.+)@([^@]+)$/.exec(s);
		if (sm) {
			const [, hostname, pkg, version] = sm;
			if (!hostname || !pkg || !version) {
				throw new Error(`PackageIdentifier.parse: bad semver id "${s}"`);
			}
			return {
				is: DependencyIsType.Semver,
				hostname,
				package: pkg,
				version
			} as PackageInfoType;
		}

		throw new Error(`PackageIdentifier.parse: bad id "${s}"`);
	}

	/**
	 * Make from id.
	 */
	static from(id: string): PackageIdentifier {
		return new PackageIdentifier(id);
	}

	/**
	 * Check id shape.
	 */
	static isId(id: string): boolean {
		try {
			PackageIdentifier.parse(id);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Value check.
	 */
	equals(other: PackageIdentifier | string): boolean {
		const v = typeof other === 'string' ? other : other.value;
		return this.#value === v;
	}
}
