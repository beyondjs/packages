import type { GitProviderType } from './types';
import type { IDiagnostic } from '@beyond-js/packages/types';

const providers: Partial<Record<GitProviderType, string>> = {
	github: 'github.com',
	gitlab: 'gitlab.com',
	bitbucket: 'bitbucket.org'
};

/**
 * Git-specific information extracted from the version string.
 * (e.g., git+https://..., github:user/repo).
 * Identifies the host, repository, owner, and optional ref (branch, tag, or commit).
 */
export /*bundle*/ class GitInfo {
	#provider: GitProviderType;
	get provider() {
		return this.#provider;
	}

	/**
	 * The host domain of the Git provider (e.g., 'github.com', 'gitlab.com').
	 */
	#host: string;
	get host() {
		return this.#host;
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

			const [, provider, owner, repo, , ref] = match;

			this.#provider = <GitProviderType>provider;
			this.#host = providers[this.#provider];
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
				this.#host = url.hostname;
				this.#provider = (() => {
					const entries = Object.entries(providers);
					const found = entries.find(([, value]) => value === this.#host)?.[0] ?? void 0;
					return (found as GitProviderType) ?? 'custom-git';
				})();
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
