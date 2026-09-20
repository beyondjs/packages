import type { IProviderIdentity } from '@beyond-js/packages/providers/types';
import type { IGraphOrigin } from './types';
import { createHash } from 'crypto';

const known: Record<string, string> = {
	'registry.npmjs.org': 'npm',
	'github.com': 'github',
	'gitlab.com': 'gitlab',
	'bitbucket.org': 'bitbucket'
};

/**
 * The origin of a node: a provider identifier that is safe inside a node key, and the canonical address
 * of the provider. Well known providers have a fixed identifier; any other registry or host gets one
 * derived from its address, with a short digest so that two addresses never share an identifier.
 */
export class Origin {
	static of(kind: 'registry' | 'git' | 'url', identity: IProviderIdentity): IGraphOrigin {
		const { registry, base } = identity;
		const address = base ? `${base}/` : void 0;
		if (known[registry]) return { provider: known[registry], registry: address };

		const slug = registry
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
		const digest = createHash('sha256').update(registry).digest('hex').slice(0, 8);
		return { provider: `${kind}-${slug}-${digest}`, registry: address };
	}
}
