import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
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
	Error = 'error' // Error state, used for failed parsing
}

export /*bundle*/ interface ISemverDependencyInfo {
	is: InfoIsType.Semver;
	provider: IProviderData;
}

export /*bundle*/ interface IGitDependencyInfo {
	is: InfoIsType.Git;
	provider: IProviderData;
	owner: string; // The owner or organization of the repository (e.g., 'user' or 'org').
	repo: string; // The name of the repository (e.g., 'my-lib').
	ref?: string; // Optional reference (branch, tag, or commit hash).
}

export /*bundle*/ interface IUrlDependencyInfo {
	is: InfoIsType.Url;
	provider: IProviderData;
	url: string; // Direct URL for tarball
	file: string; // Filename (e.g., 'mypackage.tgz')
	fname: string; // Filename without extension (e.g., 'mypackage')
	pathname: string; // URL pathname (e.g., '/path/to/mypackage.tgz')
}

export /*bundle*/ interface IAliasDependencyInfo {
	is: InfoIsType.Alias;
	target: string; // The target package name being aliased (e.g., 'lodash')
}

export /*bundle*/ interface IDependencyInfoError {
	is: InfoIsType.Error;
	error: IDiagnostic;
}
