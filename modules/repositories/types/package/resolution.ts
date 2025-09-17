import { IDiagnostic } from '@beyond-js/packages/types';
import type { ProviderType } from './providers';
import type { IGitIdentifier } from './identifiers';

/**
 * Indicates how the package version should be interpreted and resolved
 */
export /*bundle*/ enum PackageResolutionType {
	Semver = 'semver', // Standard semantic versioning (e.g., ^1.0.0)
	Git = 'git', // Git-based source (e.g., git+https://..., github:user/repo)
	Url = 'url', // Remote .tgz file (e.g., https://host/pkg.tgz)
	File = 'file', // Local file path (e.g., file:../lib)
	Unknown = 'unknown', // Unrecognized or unsupported format
	Error = 'error' // Error state, used for failed resolutions
}

/**
 * Describes how a specific dependency should be resolved from its declaration in package.json.
 * This structure is used internally to inform the registries module how to locate and fetch the package tarball.
 */
export /*bundle*/ interface IPackageResolution {
	/**
	 * Full package name as defined in package.json.
	 * Includes scope if applicable (e.g., '@beyond-js/http', 'lodash').
	 */
	package: string;

	/**
	 * Optional extracted scope from the package name (with the '@').
	 * For '@beyond-js/http', this would be '@beyond-js'.
	 * Omitted for unscoped packages.
	 */
	scope?: string;

	// 'semver', 'git', 'url', 'file', 'unknown', 'error'
	is: PackageResolutionType;

	// 'npm', 'github-pkg', 'github', 'bitbucket', 'verdaccio', 'custom', etc.
	provider: ProviderType;

	/**
	 * Raw version string as declared in package.json.
	 * Examples:
	 * - '^1.2.0' (semver)
	 * - 'github:user/repo#v1.0.0' (git)
	 * - 'https://cdn.example.com/pkg.tgz' (tarball)
	 */
	version: string;

	/**
	 * Git-specific information extracted from the version string.
	 * Present only when resolution is 'git'.
	 * Enables registries module to build a tarball URL from a remote Git repository.
	 */
	git?: IGitIdentifier;

	/**
	 * Direct URL for tarball resolution.
	 * Only present if resolution is 'tarball'.
	 */
	url?: string;

	/**
	 * Optional metadata for failed resolutions.
	 * Contains machine-readable code and human-readable explanation.
	 */
	errors?: IDiagnostic;

	/**
	 * Optional developer warnings (e.g., about credentials or unsupported formats).
	 */
	warnings?: IDiagnostic[];
}
