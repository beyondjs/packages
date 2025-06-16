import { TokenResolver } from './types';
import { Source } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class LocalTokenResolver implements TokenResolver {
	async resolve(project: string, source: Source): Promise<string | { user?: string; token: string } | undefined> {
		const npmrcPath = path.join(process.cwd(), '.npmrc');
		if (!fs.existsSync(npmrcPath)) return undefined;

		const content = fs.readFileSync(npmrcPath, 'utf8');

		switch (source) {
			case 'npm': {
				const match = content.match(/registry\.npmjs\.org\/.*:_authToken=(\w+)/);
				if (!match) return undefined;
				return match[1];
			}

			case 'github-pkg': {
				const match = content.match(/npm\.pkg\.github\.com\/.*:_authToken=(\w+)/);
				const user = process.env.GITHUB_USER;
				if (!match || !user) return undefined;
				return { user, token: match[1] };
			}

			default:
				return undefined;
		}
	}
}
