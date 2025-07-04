import type { TokenResolver } from './resolver/types';
import type { IInfo, ILocatorResult } from './types';
import { npm } from './adapters/npm';
import { github } from './adapters/github';
import { gitlab } from './adapters/gitlab';
import { artifactory } from './adapters/artifactory';
import { direct } from './adapters/url';

export class Locator {
	constructor(private tokens: TokenResolver) {}

	async resolve(input: string, project: string): Promise<ILocatorResult> {
		const info = this.parse(input);
		if ('error' in info) return info;

		switch (info.source) {
			case 'npm': {
				const token = await this.tokens.resolve(project, 'npm');
				return npm(info, typeof token === 'string' ? token : undefined);
			}

			case 'github': {
				const auth = await this.tokens.resolve(project, 'github');
				return github(info, typeof auth === 'object' ? auth : undefined);
			}

			case 'github-pkg': {
				const auth = await this.tokens.resolve(project, 'github');
				if (!auth || typeof auth !== 'object' || !auth.user || !auth.token) {
					return {
						error: {
							code: 'MISSING_GITHUB_AUTH',
							text: 'Missing GitHub user/token for GitHub Package'
						}
					};
				}
				const url = `https://npm.pkg.github.com/${info.name}/-/${info.name}-${info.version}.tgz`;
				const encoded = Buffer.from(`${auth.user}:${auth.token}`).toString('base64');
				const headers = {
					Authorization: `Basic ${encoded}`,
					'User-Agent': 'BeyondJS/1.0'
				};
				return { url, headers };
			}

			case 'gitlab': {
				const token = await this.tokens.resolve(project, 'gitlab');
				return gitlab(info, typeof token === 'string' ? token : undefined);
			}

			case 'artifactory': {
				const token = await this.tokens.resolve(project, 'artifactory');
				return artifactory(info, typeof token === 'string' ? token : undefined);
			}

			case 'url':
				return direct(info);
		}

		return { error: { code: 'UNKNOWN_SOURCE', text: 'Unknown source' } };
	}

	private parse(input: string): IInfo | LocatorError {
		if (input.startsWith('url:')) return { name: 'url', version: '', source: 'url', ref: input.slice(4) };
		if (input.startsWith('artifactory:'))
			return { name: 'artifactory', version: '', source: 'artifactory', ref: input.slice(12) };
		if (input.startsWith('github-pkg:')) {
			const raw = input.slice(11);
			const [name, version] = raw.split('@');
			if (!name || !version) return { error: { code: 'INVALID_GITHUB_PKG', text: 'Missing name or version' } };
			return { name, version, source: 'github-pkg' };
		}
		if (input.startsWith('github:')) {
			const raw = input.slice(7);
			const [name, version] = raw.split('@');
			if (!name || !version) return { error: { code: 'INVALID_GITHUB', text: 'Missing name or version' } };
			return { name, version, source: 'github', ref: name };
		}
		if (input.startsWith('gitlab:')) {
			const raw = input.slice(7);
			const [name, version] = raw.split('@');
			if (!name || !version) return { error: { code: 'INVALID_GITLAB', text: 'Missing name or version' } };
			return { name, version, source: 'gitlab', ref: name };
		}
		const [name, version] = input.split('@');
		if (!name || !version) return { error: { code: 'INVALID_NPM', text: 'Missing name or version' } };
		return { name, version, source: 'npm' };
	}
}
