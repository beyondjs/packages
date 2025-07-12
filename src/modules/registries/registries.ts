import { IRegistryConfig } from './types';
import { Rules } from './rules';

/**
 * Registry manager that holds known registries and associated scopes.
 *
 * Provides access to authentication config, validation rules, scope mapping,
 * and resolution for package dependencies.
 */
export class Registries {
	readonly registries: Map<string, IRegistryConfig> = new Map();
	readonly scopes: Map<string, string> = new Map();

	#default = 'registry.npmjs.org';

	/**
	 * Add or update a registry entry.
	 */
	add(host: string, config: IRegistryConfig): void {
		this.registries.set(host, config);
	}

	/**
	 * Register a scope to point to a registry host.
	 */
	scope(scope: string, host: string): void {
		this.scopes.set(scope, host);
	}

	/**
	 * Get registry config by host.
	 */
	get(host: string): IRegistryConfig | undefined {
		return this.registries.get(host);
	}

	/**
	 * Resolve the registry config for a package name.
	 *
	 * @example
	 *  resolve('@my-org/pkg') => mapped host config
	 *  resolve('react') => default registry config
	 */
	resolve(name: string): IRegistryConfig | undefined {
		if (name.startsWith('@')) {
			const scope = name.split('/')[0];
			const host = this.scopes.get(scope);
			if (host) return this.registries.get(host);
		}
		return this.registries.get(this.#default);
	}

	/**
	 * Validate registry configs using known rules.
	 */
	check(): void {
		for (const [host, config] of this.registries) {
			const rule = Rules.host(host);
			if (!rule) {
				console.warn(`No validation rules for host: ${host}`);
				continue;
			}
			if (!rule.valid(config)) {
				console.warn(`Invalid registry config for ${host}`);
			}
		}
	}
}
