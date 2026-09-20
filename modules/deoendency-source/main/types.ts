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
	baseurl: string; // The host of the Git provider (e.g., 'github.com', 'gitlab.com').
	base: string; // The scheme and host the provider is requested at (e.g., 'https://github.com').
	owner: string; // The owner or organization of the repository (e.g., 'user' or 'org').
	repo: string; // The name of the repository (e.g., 'my-lib').
	ref?: string; // Optional reference (branch, tag, or commit hash).
	pinned: boolean; // True when the reference is a full commit hash
}

export /*bundle*/ interface IUrlDependencySource {
	is: DependencySourceIsType.Url;
	hostname: string; // Host extracted from the URL, with its port when present (e.g., 'my-domain.com')
	url: string; // Direct URL for tarball, without the integrity fragment
	file: string; // Filename (e.g., 'mypackage.tgz')
	fname: string; // Filename without extension (e.g., 'mypackage')
	pathname: string; // URL pathname (e.g., '/path/to/mypackage.tgz')
	integrity?: string; // Subresource integrity declared as the URL fragment (e.g., 'sha512-…')
}

export /*bundle*/ interface IAliasDependencySource {
	is: DependencySourceIsType.Alias;
	target: string; // The target package name being aliased (e.g., 'lodash')
	spec: string; // The version specifier of the target (e.g., '^4.17.0')
}

export /*bundle*/ interface IDependencySourceError {
	is: DependencySourceIsType.Error;
	error: IDiagnostic;
}
