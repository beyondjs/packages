/**
 * Represents the origin from which registry settings were loaded.
 */
export /*bundle*/ type OriginType = 'project-rc' | 'workspace-rc' | 'user-rc' | 'global-rc' | 'env-vars' | 'db';

export /*bundle*/ interface IProvidersSettings {
	// Scopes to registry mapping: the key is the scope and the value is the repository host
	get scopes(): Map<string, string>;

	// The hosts map: the key is the host and the value is the repository auth type
	get hosts(): Map<string, IProviderAuth>;

	// The default repository host
	get default(): { host: string; auth?: IProviderAuth };
}

/**
 * Authentication method used for the registry.
 */
export /*bundle*/ type ProviderAuthMode =
	| 'token' // e.g., _authToken=abc123
	| 'basic' // e.g., _auth=base64
	| 'user-pass'; // e.g., username + password

export /*bundle*/ interface IProviderAuthData {
	mode: ProviderAuthMode;
	token: string;
	user?: string;
}

export /*bundle*/ interface IProviderAuth extends IProviderAuthData {
	origin: OriginType;
}
