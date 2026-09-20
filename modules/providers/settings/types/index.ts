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
	| 'db'
	| 'options';

export /*bundle*/ interface IProviderData {
	// Registry host name without port, e.g., "registry.npmjs.org"
	hostname: string;

	// Normalized base endpoint: scheme, host, non-default port and path prefix, without a trailing slash,
	// e.g., "https://registry.npmjs.org" or "http://localhost:4873/npm". Every request is built from it.
	base: string;

	// Identity of the registry: host, non-default port and path prefix, e.g., "localhost:4873/npm".
	// It is what cache records, release identities and graph origins are keyed by.
	registry?: string;

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

/**
 * Settings given explicitly by the consumer, for example the registries of one tenant. They take
 * precedence over every discovered source.
 */
export /*bundle*/ interface IProvidersValues {
	default?: { registry?: string; auth?: IProviderAuthData };
	scopes?: Record<string, { registry: string; auth?: IProviderAuthData }>;
	hosts?: Record<string, IProviderAuthData>;
}
