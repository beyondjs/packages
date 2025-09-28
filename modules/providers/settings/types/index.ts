/**
 * Represents the origin from which registry settings were loaded.
 */
export /*bundle*/ type OriginType =
	| 'default'
	| 'unregistered'
	| 'project-rc'
	| 'workspace-rc'
	| 'user-rc'
	| 'global-rc'
	| 'env-vars'
	| 'db';

export /*bundle*/ interface IProviderData {
	// Registry domain, e.g., "registry.npmjs.org"
	hostname: string;

	// Base endpoint of the registry including protocol, e.g., "https://registry.npmjs.org"
	base: string;

	// Authentication method used for the provider
	auth: IProviderAuthData;

	// Source from which the settings were loaded
	origin: OriginType;
}

export /*bundle*/ interface IProvidersSettings {
	get scopes(): Map<string, IProviderData>;
	get hosts(): Map<string, IProviderData>;
	get default(): IProviderData;
}

/**
 * Authentication method used for the registry.
 */
export /*bundle*/ type ProviderAuthMode =
	| 'none' // No authentication
	| 'token' // e.g., _authToken=abc123
	| 'basic' // e.g., _auth=base64
	| 'user-pass'; // e.g., username + password

export /*bundle*/ interface IProviderAuthData {
	mode: ProviderAuthMode;
	token?: string;
	user?: string;
}
