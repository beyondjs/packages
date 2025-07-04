import { TokenResolver } from './types';
import { Source } from '../types';

export class CiTokenResolver implements TokenResolver {
	async resolve(project: string, source: Source): Promise<string | { user?: string; token: string } | undefined> {
		switch (source) {
			case 'npm':
				return process.env.NPM_TOKEN || undefined;

			case 'github':
			case 'github-pkg': {
				const token = process.env.GITHUB_TOKEN;
				const user = process.env.GITHUB_USER;
				if (token && user) return { user, token };
				return undefined;
			}

			case 'gitlab':
				return process.env.GITLAB_TOKEN || undefined;

			case 'artifactory':
				return process.env.ARTIFACTORY_TOKEN || undefined;

			default:
				return undefined;
		}
	}
}
