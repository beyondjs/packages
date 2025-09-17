import type {
	IPackageResolution,
	GitRepositoryType,
	IGitIdentifier,
	GitReferenceType
} from '@beyond-js/packages/repositories/types';

const providers: Partial<Record<GitRepositoryType, string>> = {
	github: 'github.com',
	gitlab: 'gitlab.com',
	bitbucket: 'bitbucket.org'
};

/**
 * Parses git-based dependency specifiers (e.g., git+https://..., github:user/repo).
 * Identifies the host, repository, owner, and optional ref (branch, tag, or commit).
 */
export class GitParser implements IGitIdentifier {
	// 'github' | 'gitlab' | 'bitbucket' | 'custom-git'
	#provider: GitRepositoryType;
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
	#ref?: GitReferenceType;
	get ref() {
		return this.#ref;
	}

	parse(version: string) {
		// Handles shorthand formats: github:user/repo[#ref], gitlab:user/repo[#ref]
		if (version.startsWith('github:') || version.startsWith('gitlab:')) {
			const match = /^(\w+):([^/]+)\/([^#]+)(#(.+))?$/.exec(version);
			if (!match) return null;

			const [, provider, owner, repo, , ref] = match;

			this.#host = providers[provider as GitRepositoryType] || 'custom';
			this.#owner = owner;
			this.#repo = repo;
			this.#ref = ref as GitReferenceType;

			this.#host = `${provider}.com`;

			return { host, owner, repo, ref, repository };
		}

		// Handles full git URLs like git+https://host/user/repo.git[#ref]
		if (version.startsWith('git+')) {
			try {
				const url = new URL(version.replace(/^git\+/, ''));
				const [owner, repoRaw] = url.pathname.replace(/^\/+/, '').split('/');
				if (!owner || !repoRaw) return null;

				const repo = repoRaw.replace(/\.git$/, '');
				const ref = url.hash ? url.hash.slice(1) : undefined;
				const host = url.hostname;
				const repository = GitParser.known[host] || 'custom';

				return { host, owner, repo, ref, repository };
			} catch {
				return null;
			}
		}

		return null;
	}
}
