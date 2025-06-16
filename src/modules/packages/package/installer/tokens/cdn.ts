import { TokenResolver } from './types';
import { Source } from '../types';

export class CdnTokenResolver implements TokenResolver {
	private collection = new Collection<CdnTokenRecord>(config);

	async resolve(
		project: string,
		source: Source,
		domain?: string
	): Promise<string | { user?: string; token: string } | undefined> {
		await this.collection.ready;

		const match = this.collection.all.find(
			doc => doc.project === project && doc.source === source && (!domain || doc.domain === domain)
		);

		if (!match) return undefined;
		if (match.token && match.user) return { token: match.token, user: match.user };
		if (match.token) return match.token;
		return undefined;
	}
}
