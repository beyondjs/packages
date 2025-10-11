import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import type { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ type DependencyDataType =
	| IUndefinedDependencyData
	| ISemverDependencyData
	| IGitDependencyData
	| IUrlDependencyData
	| IAliasDependencyData
	| IDependencyDataError;

/**
 * Indicates how the package version should be interpreted and resolved
 */
export /*bundle*/ enum DependencyIsType {
	Semver = 'semver', // Standard semantic versioning (e.g., ^1.0.0)
	Git = 'git', // Git-based source (e.g., git+https://..., github:user/repo)
	Url = 'url', // Remote .tgz file (e.g., https://host/pkg.tgz)
	Alias = 'alias', // Package alias (e.g., npm:lib@^1.0.0)
	File = 'file', // Local file path (e.g., file:../lib)
	Error = 'error', // Error state, used for failed parsing
	Undefined = 'undefined' // Undefined or empty version
}

export /*bundle*/ interface IUndefinedDependencyData {
	is: DependencyIsType.Undefined;
}

export /*bundle*/ interface ISemverDependencyData {
	is: DependencyIsType.Semver;

	/**
	 * Indicates if the version is a range (e.g., '^1.0.0', '~2.3.4') or a specific version (e.g., '1.2.3').
	 * Always false for non-semver types (git, url, alias).
	 */
	range: boolean;
}

export /*bundle*/ interface IGitDependencyData {
	is: DependencyIsType.Git;
	baseurl: string; // The base URL of the Git provider (e.g., 'github.com', 'gitlab.com').
	owner: string; // The owner or organization of the repository (e.g., 'user' or 'org').
	repo: string; // The name of the repository (e.g., 'my-lib').
	ref?: string; // Optional reference (branch, tag, or commit hash).
}

export /*bundle*/ interface IUrlDependencyData {
	is: DependencyIsType.Url;
	hostname: string; // Hostname extracted from the URL (e.g., 'my-domain.com')
	url: string; // Direct URL for tarball
	file: string; // Filename (e.g., 'mypackage.tgz')
	fname: string; // Filename without extension (e.g., 'mypackage')
	pathname: string; // URL pathname (e.g., '/path/to/mypackage.tgz')
}

export /*bundle*/ interface IAliasDependencyData {
	is: DependencyIsType.Alias;
	target: string; // The target package name being aliased (e.g., 'lodash')
}

export /*bundle*/ interface IDependencyDataError {
	is: DependencyIsType.Error;
	error: IDiagnostic;
}
