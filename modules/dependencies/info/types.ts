import type { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ type DependencyInfoType =
	| ISemverDependencyInfo
	| IGitDependencyInfo
	| IUrlDependencyInfo
	| IAliasDependencyInfo
	| IDependencyInfoError;

/**
 * Indicates how the package version should be interpreted and resolved
 */
export /*bundle*/ enum InfoIsType {
	Semver = 'semver', // Standard semantic versioning (e.g., ^1.0.0)
	Git = 'git', // Git-based source (e.g., git+https://..., github:user/repo)
	Url = 'url', // Remote .tgz file (e.g., https://host/pkg.tgz)
	Alias = 'alias', // Package alias (e.g., npm:lib@^1.0.0)
	File = 'file', // Local file path (e.g., file:../lib)
	Unknown = 'unknown', // Unrecognized or unsupported format
	Error = 'error' // Error state, used for failed parsing
}

export /*bundle*/ interface ISemverDependencyInfo {
	is: InfoIsType.Semver;
}

/**
 * Git-based providers (source deps).
 */
export /*bundle*/ type GitProviderType = 'github' | 'gitlab' | 'bitbucket' | 'custom-git'; // any other git host

export /*bundle*/ interface IGitDependencyInfo {
	is: InfoIsType.Git;

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

export /*bundle*/ interface IUrlDependencyInfo {
	is: InfoIsType.Url;

	/**
	 * Direct URL for tarball
	 * Only present if dependency is a 'url'.
	 */
	url: string;
}

export /*bundle*/ interface IAliasDependencyInfo {
	is: InfoIsType.Alias;

	target: string; // The target package name being aliased (e.g., 'lodash')
}

export /*bundle*/ interface IDependencyInfoError {
	is: InfoIsType.Error;

	error: IDiagnostic;
}
