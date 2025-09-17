import type { GitProviderType, SemverProviderType } from './providers';

/**
 * Represents a package identifier for NPM or similar registries.
 * This is used for packages that are resolved from the NPM registry or similar sources.
 * It includes the provider type, package name, and exact version resolved.
 */
export /*bundle*/ interface ISemverIdentifier {
	provider: SemverProviderType;
	name: string;
	version: string; // exact version resolved (no semver range)
}

export /*bundle*/ type GitReferenceType = 'branch' | 'tag' | 'commit';

/**
 * Represents a Git-based package identifier.
 * This is used for packages hosted on Git platforms like GitHub, GitLab, etc.
 * It includes the host, owner, repository name, and an optional reference (branch, tag, or commit).
 */
export /*bundle*/ interface IGitIdentifier {
	repository: GitProviderType;

	/**
	 * The host domain of the Git provider (e.g., 'github.com', 'gitlab.com').
	 */
	host: string;

	/**
	 * The owner or organization of the repository (e.g., 'user' or 'org').
	 */
	owner: string;

	/**
	 * The name of the repository (e.g., 'my-lib').
	 */
	repo: string;

	/**
	 * Optional reference (branch, tag, or commit hash).
	 * If omitted, defaults to the default branch of the repository (e.g., 'main').
	 */
	ref?: GitReferenceType;
}

// PackageIdentifier can also be a string, in which case it represents a direct URL to a tarball package
export /*bundle*/ type PackageIdentifierType = ISemverIdentifier | IGitIdentifier | string;
