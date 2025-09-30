export /*bundle*/ interface IProjectLayerData {
	platform: string; // Platform name, e.g., "web", "node", etc.
	server?: number | string; // Server port number in local environment or CDN subdomain in CDN environments
}

export /*bundle*/ interface IProjectCommonData {
	/**
	 * Complete set of packages that belong to the project.
	 * Each entry includes a strongly typed identifier (`PackageIdentifier`)
	 * containing both the canonical ID (value) and its resolved origin info (semver/git/url).
	 */
	packages: string[];

	layers: IProjectLayerData[];

	dependencies?: {
		// Complete list of versioned packages that are dependencies of the project
		list: string[];

		// Map: each package -> its immediate dependencies
		// Example: { "app@1.0.0": ["a@2.0.0", "b@1.0.0"], "b@1.0.0": ["c@3.0.0"], ... }
		tree: Record<string, string[]>;
	};
}
