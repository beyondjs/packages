import type { RepositoryAuthType } from './auth';
import type { RepositoriesResponse } from '@beyond-js/packages/repositories/response';
import type { IPackageSpecResponse } from './package';

/**
 * Known identifiers for well-known or custom registries.
 */
export /*bundle*/ type RepositoryType =
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

export /*bundle*/ interface IRepository {
	name: string;
	type: RepositoryType;
	url: string;
	default?: boolean;
	write?: boolean;
	registry?: IRegistry;
}

export /*bundle*/ interface IRegistry {
	versions(pkg: string): Promise<RepositoriesResponse<string[]>>;
	spec(name: string, version: string): Promise<IPackageSpecResponse>;
}

export /*bundle*/ interface IScope {
	name: string;
	repository: IRepository;
	auth?: RepositoryAuthType;
}
