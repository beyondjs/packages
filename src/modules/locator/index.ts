import type { TokenResolver } from './types';
import type { IInfo, ILocatorResult } from './types';

import { npm } from './adapters/npm';
import { github } from './adapters/github';
import { gitlab } from './adapters/gitlab';
import { artifactory } from './adapters/artifactory';
import { direct } from './adapters/url';

/**
 * Generate a consistent error result.
 */
function fail(code: string, text: string): ILocatorResult {
	return { error: { code, text } };
}

/**
 * Create basic auth headers for sources like GitHub Packages.
 */
function basic(user: string, token: string): Record<string, string> {
	const encoded = Buffer.from(`${user}:${token}`).toString('base64');
	return {
		Authorization: `Basic ${encoded}`,
		'User-Agent': 'BeyondJS/1.0'
	};
}

/**
 * Safe split of name@version, supporting scoped packages.
 */
function split(input: string): [string, string] | undefined {
	const match = input.match(/^(@[^/]+\/[^@]+|[^@]+)@(.+)$/);
	if (!match) return;
	return [match[1], match[2]];
}

export /*bundle*/ class Locator {
	constructor(private tokens: TokenResolver) {}

	async resolve(input: string, project: string): Promise<ILocatorResult> {
		const info = this.parse(input);
		if ('error' in info) return info;

		const getToken = async (source: PackageSource) => await this.tokens.resolve(project, source);

		switch (info.source) {
			case 'npm': {
				const token = await getToken('npm');
				return npm(info, typeof token === 'string' ? token : undefined);
			}

			case 'github': {
				const auth = await getToken('github');
				return github(info, typeof auth === 'object' ? auth : undefined);
			}

			case 'gitlab': {
				const token = await getToken('gitlab');
				return gitlab(info, typeof token === 'string' ? token : undefined);
			}

			case 'bitbucket': {
				const token = await getToken('bitbucket');
				const { bitbucket } = await import('./adapters/bitbucket');
				return bitbucket(info, typeof token === 'string' ? token : undefined);
			}

			case 'artifactory': {
				const token = await getToken('artifactory');
				return artifactory(info, typeof token === 'string' ? token : undefined);
			}

			case 'verdaccio': {
				const token = await getToken('verdaccio');
				const { verdaccio } = await import('./adapters/verdaccio');
				return verdaccio(info, typeof token === 'string' ? token : undefined);
			}

			case 'azure': {
				const token = await getToken('azure');
				const { azure } = await import('./adapters/azure');
				return azure(info, typeof token === 'string' ? token : undefined);
			}

			case 'google': {
				const token = await getToken('google');
				const { google } = await import('./adapters/google');
				return google(info, typeof token === 'string' ? token : undefined);
			}

			case 'aws': {
				const token = await getToken('aws');
				const { aws } = await import('./adapters/aws');
				return aws(info, typeof token === 'string' ? token : undefined);
			}

			case 'custom': {
				return direct(info);
			}
		}

		return { error: { code: 'UNKNOWN_SOURCE', text: `Unknown source: ${info.source}` } };
	}

	private parse(input: string): IInfo {
		if (input.startsWith('url:')) {
			return { name: 'url', version: '', source: 'custom', ref: input.slice(4) };
		}

		if (input.startsWith('github-pkg:')) {
			const raw = input.slice(11);
			const [name, version] = raw.split('@');
			if (!name || !version) {
				return { error: { code: 'INVALID_GITHUB_PKG', text: 'Missing name or version' } };
			}
			return { name, version, source: 'github' };
		}

		const parsers: Record<PackageSource, string> = {
			github: 'github:',
			gitlab: 'gitlab:',
			bitbucket: 'bitbucket:',
			artifactory: 'artifactory:',
			verdaccio: 'verdaccio:',
			azure: 'azure:',
			google: 'google:',
			aws: 'aws:',
			npm: '' // default
		};

		for (const [source, prefix] of Object.entries(parsers)) {
			if (prefix && input.startsWith(prefix)) {
				const raw = input.slice(prefix.length);
				const [name, version] = raw.split('@');
				if (!name || !version) {
					return { error: { code: `INVALID_${source.toUpperCase()}`, text: 'Missing name or version' } };
				}
				return { name, version, source: source as PackageSource, ref: name };
			}
		}

		// Default to npm if no prefix
		const [name, version] = input.split('@');
		if (!name || !version) {
			return { error: { code: 'INVALID_NPM', text: 'Missing name or version' } };
		}
		return { name, version, source: 'npm' };
	}
}
