import type { IPackageResolution, RepositoryType } from '@beyond-js/packages/repositories/types';

/**
 * Parses git-based dependency specifiers (e.g., git+https://..., github:user/repo).
 * Identifies the host, repository, owner, and optional ref (branch, tag, or commit).
 */
export class GitParser {
	static known: Record<string, RepositoryType> = {
		'github.com': 'github',
		'gitlab.com': 'gitlab',
		'bitbucket.org': 'bitbucket'
	};

	static parse(version: string): (IPackageResolution['git'] & { repository: RepositoryType }) | null {
		// Handles shorthand formats: github:user/repo[#ref], gitlab:user/repo[#ref]
		if (version.startsWith('github:') || version.startsWith('gitlab:')) {
			const match = /^(\w+):([^/]+)\/([^#]+)(#(.+))?$/.exec(version);
			if (!match) return null;

			const [, provider, owner, repo, , ref] = match;
			const host = `${provider}.com`;
			const repository = GitParser.known[host] || 'custom';

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
