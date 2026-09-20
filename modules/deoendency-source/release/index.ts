import { type DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { IProviderData } from '@beyond-js/packages/providers/settings/types';

export /*bundle*/ class DependencySourceRelease {
	#source: DependencySource;
	get source(): DependencySource {
		return this.#source;
	}

	#provider: IProviderData;
	get provider() {
		return this.#provider;
	}

	#release: string;
	get release() {
		return this.#release;
	}

	#id: string;
	get id() {
		return this.#id;
	}

	#path: string;
	get path() {
		return this.#path;
	}

	/**
	 * Make the id and path of the dependency release
	 */
	constructor(dependency: DependencySourceProvider, release: string) {
		const { source, provider } = dependency;
		if (!release) throw new Error('The release of the dependency is required');
		this.#source = source;
		this.#provider = provider;
		this.#release = release;

		switch (source.data.is) {
			case DependencySourceIsType.Semver: {
				// The registry identity carries host, port and path prefix: two registries of one host differ
				const hostname = provider.registry || provider.hostname;
				const pkg = source.package;
				this.#id = `semver://${hostname}/${pkg}@${release}`;
				this.#path = `${hostname}/${pkg}/${release}`;
				return;
			}

			case DependencySourceIsType.Git: {
				const hostname = provider.registry || provider.hostname;
				const owner = source.data.owner;
				const repo = source.data.repo;
				this.#id = `git://${hostname}/${owner}/${repo}@${release}`;
				this.#path = `git/${hostname}/${owner}/${repo}/${release}`;
				return;
			}

			case DependencySourceIsType.Url: {
				this.#id = `digest://${release}`;
				this.#path = `digest/${release}`;
				return;
			}

			default:
				throw new Error(`Dependency type is invalid "${source.data.is}"`);
		}
	}
}
