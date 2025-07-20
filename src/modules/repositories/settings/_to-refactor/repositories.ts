import { IRepositoryConfig } from './types';
import { rules } from './rules';

export class RepositoriesSettings {
	readonly repositories: Map<string, IRepositoryConfig> = new Map();
	readonly scopes: Map<string, string> = new Map();

	#default = 'registry.npmjs.org';

	/**
	 * Add or update a repository entry.
	 */
	add(host: string, config: IRepositoryConfig): void {
		this.repositories.set(host, config);
	}

	/**
	 * Register a scope to point to a repository host.
	 */
	scope(scope: string, host: string): void {
		this.scopes.set(scope, host);
	}

	/**
	 * Get repository config by host.
	 */
	get(host: string): IRepositoryConfig | undefined {
		return this.repositories.get(host);
	}

	/**
	 * Resolve the repository config for a package name.
	 *
	 * @example
	 *  resolve('@my-org/pkg') => mapped host config
	 *  resolve('react') => default repository config
	 */
	resolve(name: string): IRepositoryConfig | undefined {
		if (name.startsWith('@')) {
			const scope = name.split('/')[0];
			const host = this.scopes.get(scope);
			if (host) return this.repositories.get(host);
		}
		return this.repositories.get(this.#default);
	}

	/**
	 * Validate repository configs using known rules.
	 */
	check(): void {
		for (const [host, config] of this.repositories) {
			const rule = rules.host(host);
			if (!rule) {
				console.warn(`No validation rules for host: ${host}`);
				continue;
			}
			if (!rule.valid(config)) {
				console.warn(`Invalid repository config for ${host}`);
			}
		}
	}
}
