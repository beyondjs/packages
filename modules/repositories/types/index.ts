/**
 * Identifiers for well-known or custom registries.
 */
export /*bundle*/ type RepositoryType =
	| 'default' // Default registry, typically NPM (https://registry.npmjs.org)
	| 'npm' // Official NPM registry (https://registry.npmjs.org)
	| 'github' // GitHub Git repository (source only, not a package registry)
	| 'github-pkg' // GitHub Package Registry (https://npm.pkg.github.com)
	| 'gitlab' // GitLab NPM-compatible registry
	| 'bitbucket' // Bitbucket Git repositories or custom registries
	| 'artifactory' // JFrog Artifactory (local or proxy registry)
	| 'verdaccio' // Verdaccio self-hosted NPM-compatible registry
	| 'azure' // Azure Artifacts registry (npm feed)
	| 'google' // Google Artifact Registry (GAR)
	| 'aws' // AWS CodeArtifact registry
	| 'custom'; // Custom or unsupported registry type (manual implementation required)
