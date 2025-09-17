/**
 * NPM-compatible registries (semver-based).
 */
export /*bundle*/ type SemverProviderType =
	| 'default' // usually https://registry.npmjs.org
	| 'npm' // official npm
	| 'github-pkg' // GitHub Packages (npm.pkg.github.com)
	| 'gitlab-pkg' // GitLab Packages (npm-compatible)
	| 'artifactory' // JFrog Artifactory
	| 'verdaccio' // Verdaccio
	| 'azure-artifacts' // Azure Artifacts (npm feed)
	| 'google-artifact-registry' // GAR
	| 'aws-codeartifact' // AWS CodeArtifact
	| 'custom-registry'; // any other npm-compatible host

/**
 * Git-based providers (source deps).
 */
export /*bundle*/ type GitProviderType = 'github' | 'gitlab' | 'bitbucket' | 'custom-git'; // any other git host

/**
 * Unified provider type.
 */
export /*bundle*/ type ProviderType = SemverProviderType | GitProviderType;
