import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * Git-specific information extracted from the version string.
 * (e.g., git+https://..., github:user/repo).
 * Identifies the host, repository, owner, and optional ref (branch, tag, or commit).
 */
export /*bundle*/ class GitInfo {
	#baseurl: string;
	get baseurl() {
		return this.#baseurl;
	}

	/**
	 * The owner or organization of the repository (e.g., 'user' or 'org').
	 */
	#owner: string;
	get owner() {
		return this.#owner;
	}

	/**
	 * The name of the repository (e.g., 'my-lib').
	 */
	#repo: string;
	get repo() {
		return this.#repo;
	}

	/**
	 * Optional reference (branch, tag, or commit hash).
	 * If omitted, defaults to the default branch of the repository (e.g., 'main').
	 */
	#ref?: string;
	get ref() {
		return this.#ref;
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	constructor(version: string) {
		// Handles shorthand formats: github:user/repo[#ref], gitlab:user/repo[#ref]
		if (version.startsWith('github:') || version.startsWith('gitlab:') || version.startsWith('bitbucket:')) {
			const match = /^(\w+):([^/]+)\/([^#]+)(#(.+))?$/.exec(version);
			if (!match) return null;

			const [, baseurl, owner, repo, , ref] = match;

			this.#baseurl = baseurl;
			this.#owner = owner;
			this.#repo = repo;
			this.#ref = ref;
			return;
		}

		// Handles full git URLs like git+https://host/user/repo.git[#ref]
		if (version.startsWith('git+')) {
			try {
				const url = new URL(version.replace(/^git\+/, ''));
				const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
				if (!owner || !repo) return null;

				this.#repo = repo.replace(/\.git$/, '');
				this.#ref = url.hash ? url.hash.slice(1) : undefined;
				this.#baseurl = url.origin;
			} catch {
				const code = 'INVALID_GIT_URL';
				const message = `Invalid git URL format: ${version}`;
				this.#error = { code, message };
				return;
			}
		}

		return null;
	}
}
