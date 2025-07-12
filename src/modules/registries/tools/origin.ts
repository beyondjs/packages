import type { TRegistryId } from '../types';

export function origin(source: TRegistryId): string {
	switch (source) {
		case 'npm':
			return 'registry.npmjs.org';
		case 'github':
		case 'github-pkg':
			return 'npm.pkg.github.com';
		case 'gitlab':
			return 'gitlab.com';
		case 'bitbucket':
			return 'api.bitbucket.org';
		case 'azure':
			return 'pkgs.dev.azure.com';
		case 'verdaccio':
			return 'localhost';
		case 'google':
			return 'pkg.dev';
		case 'aws':
			return 'aws.amazon.com';
		case 'artifactory':
			return 'artifactory';
		case 'custom':
			return 'custom';
		default:
			throw new Error(`Unknown source: ${source}`);
	}
}
