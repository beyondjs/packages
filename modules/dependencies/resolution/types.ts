import type { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ type DependencyResolutionType =
	| ISemverDependencyResolution
	| IGitDependencyResolution
	| IUrlDependencyResolution
	| IAliasDependencyResolution
	| IDependencyResolutionError;

/**
 * Indicates how the package version should be interpreted and resolved
 */
export /*bundle*/ enum ResolutionIsType {
	Semver = 'semver', // Standard semantic versioning (e.g., ^1.0.0)
	Git = 'git', // Git-based source (e.g., git+https://..., github:user/repo)
	Url = 'url', // Remote .tgz file (e.g., https://host/pkg.tgz)
	Alias = 'alias', // Package alias (e.g., npm:lib@^1.0.0)
	File = 'file', // Local file path (e.g., file:../lib)
	Unknown = 'unknown', // Unrecognized or unsupported format
	Error = 'error' // Error state, used for failed resolutions
}

export /*bundle*/ interface ISemverDependencyResolution {
	is: ResolutionIsType.Semver;
}

/**
 * Git-based providers (source deps).
 */
export /*bundle*/ type GitProviderType = 'github' | 'gitlab' | 'bitbucket' | 'custom-git'; // any other git host

export /*bundle*/ interface IGitDependencyResolution {
	is: ResolutionIsType.Git;

	git?: {
		/**
		 * The type of Git provider (e.g., 'github', 'gitlab', 'bitbucket', or 'custom-git').
		 */
		provider: GitProviderType;

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
		 */
		ref?: string;
	};
}

export /*bundle*/ interface IUrlDependencyResolution {
	is: ResolutionIsType.Url;

	/**
	 * Direct URL for tarball resolution.
	 * Only present if resolution is 'url'.
	 */
	url: string;
}

export /*bundle*/ interface IAliasDependencyResolution {
	is: ResolutionIsType.Alias;

	target: string; // The target package name being aliased (e.g., 'lodash')
}

export /*bundle*/ interface IDependencyResolutionError {
	is: ResolutionIsType.Error;

	error: IDiagnostic;
}
