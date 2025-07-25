import type { RepositoryType } from '../';
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
	name: string;

	/**
	 * Optional extracted scope from the package name (without the '@').
	 * For '@beyond-js/http', this would be 'beyond-js'.
	 * Omitted for unscoped packages.
	 */
	scope?: string;

	/**
	 * Raw version string as declared in package.json.
	 * Examples:
	 * - '^1.2.0' (semver)
	 * - 'github:user/repo#v1.0.0' (git)
	 * - 'https://cdn.example.com/pkg.tgz' (tarball)
	 */
	version: string;

	/**
	 * Resolution strategy determined from the version string.
	 * Possible values:
	 * - 'semver'
	 * - 'git'
	 * - 'tarball'
	 * - 'unknown'
	 */
	type?: PackageResolutionType;

	/**
	 * Semantic version specifier (e.g., '^1.2.0').
	 * Present only if resolution is 'semver'.
	 * Undefined otherwise.
	 */
	semver?: string;

	/**
	 * The source or provider used to resolve the package.
	 * Applies to semver and git resolutions that involve known registries or platforms.
	 * Examples:
	 * - 'npm'
	 * - 'github'
	 * - 'gitlab'
	 * - 'verdaccio'
	 * - 'custom'
	 */
	repository?: RepositoryType;

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
	error?: {
		code: string;
		text: string;
	};

	/**
	 * Optional developer warnings (e.g., about credentials or unsupported formats).
	 */
	warnings?: string[];
}
