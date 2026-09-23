import type { IProviderIdentity } from '@beyond-js/packages/providers/types';
import type { IGraphOrigin } from './types';
import { createHash } from 'crypto';

/**
 * The origin of a node: a provider identifier that is safe inside a node key and an object key, and the
 * canonical address of the provider.
 *
 * - The public npm registry is `npm`. Any other registry gets `registry-<slug>-<digest>`: a readable slug of its
 *   address and 128 bits of the SHA-256 of `host[:port][/prefix]`, so two addresses never share an identifier
 *   and none can be forged by choosing an address whose slug looks like another's. A registry identifier never
 *   equals the source words `git`, `digest` or `npm` of other keys.
 * - A git node comes from one repository at one commit: `git-<slug>-<digest>` of `host/owner/repo@commit`, the
 *   tree its source was taken from.
 * - An archive URL has no provider of its own: its identity is its content, and its origin is `digest`.
 */
export /*bundle*/ class Origin {
	static #slug(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64)
			.replace(/-+$/, '');
	}

	static #digest(text: string): string {
		return createHash('sha256').update(text).digest('hex').slice(0, 32);
	}

	static registry(identity: IProviderIdentity): IGraphOrigin {
		const { registry, base } = identity;
		const address = base ? `${base}/` : void 0;
		if (registry === 'registry.npmjs.org') return { provider: 'npm', registry: address };
		return { provider: `registry-${Origin.#slug(registry)}-${Origin.#digest(registry)}`, registry: address };
	}

	/**
	 * @param repository `host/owner/repo`
	 * @param base Scheme and host the repository is requested at
	 */
	static git(repository: string, commit: string, base: string): IGraphOrigin {
		const provider = `git-${Origin.#slug(repository)}-${Origin.#digest(`${repository}@${commit}`)}`;
		return { provider, registry: `${base}/${repository.slice(repository.indexOf('/') + 1)}/` };
	}

	static digest(identity?: IProviderIdentity): IGraphOrigin {
		return identity?.base ? { provider: 'digest', registry: `${identity.base}/` } : { provider: 'digest' };
	}
}
