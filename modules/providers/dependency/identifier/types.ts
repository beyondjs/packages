import { InfoIsType } from '@beyond-js/packages/providers/dependency/info';

/**
 * Information for a Semver-based package identifier.
 * Example: @scope/pkg@1.2.3 from a given registry.
 */
export interface ISemverInfo {
	is: InfoIsType.Semver;
	hostname: string; // registry hostname (e.g. registry.npmjs.org)
	package: string; // package name including scope (e.g. @beyond-js/widgets)
	version: string; // resolved version (e.g. "1.2.3")
}

/**
 * Information for a Git-based package identifier.
 * Example: git/github.com/owner/repo@<commit>.
 */
export interface IGitInfo {
	is: InfoIsType.Git;
	hostname: string; // git host (e.g. github.com)
	owner: string; // repository owner
	repo: string; // repository name
	commit: string; // commit hash (e.g. "a1b2c3d4")
}

/**
 * Information for a URL-based package identifier.
 * Identified by a digest hash of its content.
 */
export interface IUrlInfo {
	is: InfoIsType.Url;
	digest: string; // content hash (e.g. "sha256-abcdef1234567890")
}

/**
 * Union of all possible package info types.
 */
export type PackageInfoType = ISemverInfo | IGitInfo | IUrlInfo;
