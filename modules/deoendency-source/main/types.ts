import type { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ type DependencySourceType =
	| ISemverDependencySource
	| IGitDependencySource
	| IUrlDependencySource
	| IAliasDependencySource
	| IDependencySourceError;

/**
 * Indicates how the package version should be interpreted and resolved
 */
export /*bundle*/ enum DependencySourceIsType {
	Semver = 'semver', // Standard semantic versioning (e.g., ^1.0.0)
	Git = 'git', // Git-based source (e.g., git+https://..., github:user/repo)
	Url = 'url', // Remote .tgz file (e.g., https://host/pkg.tgz)
	Alias = 'alias', // Package alias (e.g., npm:lib@^1.0.0)
	File = 'file', // Local file path (e.g., file:../lib)
	Error = 'error' // Error state, used for failed parsing
}

export /*bundle*/ interface ISemverDependencySource {
	is: DependencySourceIsType.Semver;

	/**
	 * Indicates if the version is a range (e.g., '^1.0.0', '~2.3.4') or a specific version (e.g., '1.2.3').
	 * Always false for non-semver types (git, url, alias).
	 */
	range: boolean;
}

export /*bundle*/ interface IGitDependencySource {
	is: DependencySourceIsType.Git;
	baseurl: string; // The base URL of the Git provider (e.g., 'github.com', 'gitlab.com').
	owner: string; // The owner or organization of the repository (e.g., 'user' or 'org').
	repo: string; // The name of the repository (e.g., 'my-lib').
	ref?: string; // Optional reference (branch, tag, or commit hash).
}

export /*bundle*/ interface IUrlDependencySource {
	is: DependencySourceIsType.Url;
	hostname: string; // Hostname extracted from the URL (e.g., 'my-domain.com')
	url: string; // Direct URL for tarball
	file: string; // Filename (e.g., 'mypackage.tgz')
	fname: string; // Filename without extension (e.g., 'mypackage')
	pathname: string; // URL pathname (e.g., '/path/to/mypackage.tgz')
}

export /*bundle*/ interface IAliasDependencySource {
	is: DependencySourceIsType.Alias;
	target: string; // The target package name being aliased (e.g., 'lodash')
}

export /*bundle*/ interface IDependencySourceError {
	is: DependencySourceIsType.Error;
	error: IDiagnostic;
}
