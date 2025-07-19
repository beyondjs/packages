/**
 * Represents the origin from which registry settings were loaded.
 */
export /*bundle*/ type OriginType = 'project-rc' | 'workspace-rc' | 'user-rc' | 'global-rc' | 'ci' | 'cdn';

/**
 * Authentication method used for the registry.
 */
export /*bundle*/ type RepositoryAuthMode =
	| 'token' // e.g., _authToken=abc123
	| 'basic' // e.g., _auth=base64
	| 'user-pass'; // e.g., username + password

/**
 * Authentication details including headers ready to be used.
 */
export /*bundle*/ type RepositoryAuthType = {
	mode: RepositoryAuthMode;
	origin: OriginType;
	token: string;
	user?: string;
	headers: Record<string, string>;
};
