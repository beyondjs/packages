import type { ICollection } from '@beyond-js/packages/persistence/types';
import type { IProviderData } from '@beyond-js/packages/providers/settings/types';

export /*bundle*/ interface ICdnProvidersSettings {
	default?: IProviderData;
	scopes?: Record<string, IProviderData>;
	hosts?: Record<string, IProviderData>;
}

export /*bundle*/ interface IProjectLayerData {
	platform: string; // Platform name, e.g., "web", "node", etc.
	server?: number | string; // Server port number in local environment or CDN subdomain in CDN environments
}

export /*bundle*/ interface IProjectData {
	id: string;
	account: { id: string; organization: { name: string } };
	name: string;

	visibility: { private: boolean };

	timestamps: {
		created: { at: number };
		updated?: { at: number };
		deleted?: { at: number };
	};

	providers: ICdnProvidersSettings;

	/**
	 * Complete set of packages that belong to the project.
	 * Each entry includes a strongly typed identifier (`PackageIdentifier`)
	 * containing both the canonical ID (value) and its resolved origin info (semver/git/url).
	 */
	packages: string[];

	layers: IProjectLayerData[];

	dependencies?: {
		// Complete list of package identifiers that are dependencies of the project
		list: string[];

		// Map: each package -> its immediate dependencies
		// Example: { "app@1.0.0": ["a@2.0.0", "b@1.0.0"], "b@1.0.0": ["c@3.0.0"], ... }
		tree: Record<string, string[]>;
	};
}

export /*bundle*/ type Projects = ICollection<IProjectData>;
