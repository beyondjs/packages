/**
 * Known identifiers for well-known or custom registries.
 */
export /*bundle*/ type TRegistryId =
	| 'npm'
	| 'github'
	| 'github-pkg'
	| 'gitlab'
	| 'bitbucket'
	| 'artifactory'
	| 'verdaccio'
	| 'azure'
	| 'google'
	| 'aws'
	| 'custom';

/**
 * Represents the origin from which registry settings were loaded.
 */
export /*bundle*/ type TOrigin = 'project-rc' | 'workspace-rc' | 'user-rc' | 'global-rc' | 'ci' | 'cdn';

/**
 * Authentication method used for the registry.
 */
export /*bundle*/ type RegistryAuthType =
	| 'token' // e.g., _authToken=abc123
	| 'basic' // e.g., _auth=base64
	| 'user-pass'; // e.g., username + password

/**
 * Authentication details including headers ready to be used.
 */
export type IRegistryAuth = {
	type: RegistryAuthType;
	token: string;
	user?: string;
	headers: Record<string, string>;
};

/**
 * Full configuration for a given registry.
 */
export type IRegistryConfig = {
	id: TRegistryId;
	host: string;
	auth?: IRegistryAuth;
	origin: TOrigin;
};

/**
 * Represents the output of a registry resolution for a given package.
 */
export type ResolvedPackage = {
	host: string;
	source: TRegistryId;
	auth?: IRegistryAuth;
};

/**
 * Represents a known package registry.
 */
export type Registry = {
	id: TRegistryId;
	source: TRegistryId;
	auth?: IRegistryAuth;
	origin: TOrigin;
};

/**
 * Defines known registry rules for host validation, headers, errors, etc.
 */
export type RegistryRule = {
	// Valid hosts for the registry, used to match or validate.
	hosts: string[];

	// Name of the registry source (used in .scopes or id resolution).
	id: TRegistryId;

	// Environment variables to check when loading from CI
	env: {
		token?: string;
		user?: string;
		pass?: string;
	};

	// Optional helper to validate host match
	match?: (host: string) => boolean;

	// Builds standard headers for authentication
	headers(auth: IRegistryAuth): Record<string, string>;

	// Build URL for .tgz download if needed
	tgz?(pkg: string, version: string): string;
};

export type DownloadTarget = {
	url: string;
	headers: Record<string, string>;
	source: TRegistryId;
};
