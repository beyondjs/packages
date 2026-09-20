import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * Hosts addressed by the shorthand prefixes that package managers accept (`github:user/repo`)
 */
const shorthands: Record<string, string> = {
	github: 'github.com',
	gitlab: 'gitlab.com',
	bitbucket: 'bitbucket.org'
};

/**
 * Git-specific information extracted from a version specifier
 * (e.g., git+https://host/owner/repo.git#ref, github:user/repo, user/repo).
 * Identifies the host, repository, owner, and optional ref (branch, tag, or commit).
 *
 * A specifier that is not a git specifier yields an instance whose `matched` is false: use
 * `GitInfo.parse()` to obtain `undefined` instead, because an instance is always truthy.
 */
export /*bundle*/ class GitInfo {
	#matched = false;
	/**
	 * True when the specifier was recognized as a git specifier, including a malformed one (see `error`)
	 */
	get matched() {
		return this.#matched;
	}

	#baseurl: string;
	/**
	 * The host of the git provider, with its port when it is not the default (e.g., 'github.com')
	 */
	get baseurl() {
		return this.#baseurl;
	}

	#base: string;
	/**
	 * The scheme and host to request the provider at (e.g., 'https://github.com')
	 */
	get base() {
		return this.#base;
	}

	#owner: string;
	/**
	 * The owner or organization of the repository (e.g., 'user' or 'org').
	 */
	get owner() {
		return this.#owner;
	}

	#repo: string;
	/**
	 * The name of the repository (e.g., 'my-lib').
	 */
	get repo() {
		return this.#repo;
	}

	#ref?: string;
	/**
	 * Optional reference (branch, tag, or commit hash).
	 * If omitted, the default branch of the repository is meant.
	 */
	get ref() {
		return this.#ref;
	}

	/**
	 * True when the reference is a full commit hash, which pins the source without asking the provider
	 */
	get pinned() {
		return !!this.#ref && /^[0-9a-f]{40}$/i.test(this.#ref);
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	constructor(version: string) {
		if (typeof version !== 'string') return;

		// Shorthand formats: github:user/repo[#ref], gitlab:user/repo[#ref], bitbucket:user/repo[#ref]
		const prefix = /^(github|gitlab|bitbucket):/.exec(version);
		// Bare shorthand: user/repo[#ref], which package managers resolve against GitHub
		const bare = !prefix && /^[^@/:\s.][^@/:\s]*\/[^@/:#\s]+(#.+)?$/.test(version);

		if (prefix || bare) {
			this.#matched = true;
			const value = prefix ? version.slice(prefix[0].length) : version;
			const match = /^([^/#]+)\/([^/#]+?)(?:\.git)?(?:#(.+))?$/.exec(value);
			if (!match) {
				this.#error = { code: 'INVALID_GIT_SPECIFIER', message: `Invalid git shorthand: ${version}` };
				return;
			}

			const [, owner, repo, ref] = match;
			this.#baseurl = shorthands[prefix ? prefix[1] : 'github'];
			this.#base = `https://${this.#baseurl}`;
			this.#owner = owner;
			this.#repo = repo;
			this.#ref = ref;
			return;
		}

		// Full git URLs: git+https://host/owner/repo.git[#ref], git+ssh://git@host/owner/repo.git, git://host/...
		if (!/^git(\+[a-z]+)?:\/\//.test(version)) return;
		this.#matched = true;

		let url: URL;
		try {
			url = new URL(version.replace(/^git\+/, ''));
		} catch {
			this.#error = { code: 'INVALID_GIT_URL', message: 'Invalid git URL format' };
			return;
		}

		const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
		if (!owner || !repo) {
			this.#error = { code: 'INVALID_GIT_URL', message: 'The git URL must name an owner and a repository' };
			return;
		}

		// Requests are made over HTTP(S): ssh and git transports identify the same host
		const scheme = url.protocol === 'http:' ? 'http' : 'https';
		this.#baseurl = url.host.toLowerCase();
		this.#base = `${scheme}://${this.#baseurl}`;
		this.#owner = owner;
		this.#repo = repo.replace(/\.git$/, '');
		this.#ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
	}

	/**
	 * Parses a specifier, returning `undefined` when it is not a git specifier
	 */
	static parse(version: string): GitInfo | undefined {
		const info = new GitInfo(version);
		return info.matched ? info : undefined;
	}
}
