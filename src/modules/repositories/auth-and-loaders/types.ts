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
