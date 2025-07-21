// tools/source.ts

import type { PackageSource } from '../types';

/**
 * Utility to resolve a registry host to its corresponding package source.
 */
export class SourceTools {
	/**
	 * Map known registry domains to their package sources.
	 */
	static resolve(host: string): PackageSource {
		if (host.includes('npmjs.org')) return 'npm';
		if (host.includes('github.com') || host.includes('npm.pkg.github.com')) return 'github';
		if (host.includes('gitlab.com')) return 'gitlab';
		if (host.includes('bitbucket.org')) return 'bitbucket';
		if (host.includes('artifactory')) return 'artifactory';
		if (host.includes('verdaccio')) return 'verdaccio';
		if (host.includes('pkgs.dev.azure.com')) return 'azure';
		if (host.includes('pkg.dev') || host.includes('npm.pkg.dev')) return 'google';
		if (host.includes('aws')) return 'aws';

		return 'custom';
	}
}
