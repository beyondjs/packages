import type { IRegistryConfig } from './types';
import { LocalLoader } from './sources/local';
import { CiLoader } from './sources/ci';
import { CdnLoader } from './sources/cdn';
import { Registries } from './registries';
import { rules } from './rules';

/**
 * Download details resolved from a package specifier.
 */
export type Download = {
	/**
	 * Resolved registry host, e.g. 'registry.npmjs.org'.
	 */
	host: string;

	/**
	 * Registry source id (npm, github, etc).
	 */
	id: string;

	/**
	 * Resolved authentication headers for the download request.
	 */
	headers: Record<string, string>;

	/**
	 * URL to fetch the package .tgz file.
	 */
	url: string;
};

/**
 * Resolves the download source for a given dependency identifier.
 * Loads registry and scope configuration from multiple sources.
 */
export class Resolver {
	readonly registries = new Registries();

	/**
	 * Load registry data from local, CI, and CDN sources.
	 *
	 * @param options Optional context path or workspace
	 */
	async load(options?: { path?: string; workspace?: string }): Promise<void> {
		const local = new LocalLoader();
		await local.process(options?.path, options?.workspace);
		this.registries.merge(local.registries);

		const ci = new CiLoader();
		await ci.process();
		this.registries.merge(ci.registries);

		const cdn = new CdnLoader();
		await cdn.process();
		this.registries.merge(cdn.registries);
	}

	/**
	 * Resolves a dependency identifier to its download source.
	 *
	 * Supports:
	 *  - Standard: '@scope/pkg@version' or 'pkg@version'
	 *  - Remote: 'github:user/repo', 'gitlab:user/repo', etc.
	 *
	 * @param id Dependency identifier
	 * @returns Download info
	 */
	resolve(id: string): Download {
		// Handle remote source like github:user/repo
		const match = id.match(/^([a-z]+):([^@]+)$/);
		if (match) {
			const [, kind, ref] = match;
			const rule = rules.get(kind as any);
			if (!rule) throw new Error(`Unknown remote source: ${kind}`);
			const config: IRegistryConfig = {
				id: kind,
				host: rule.hosts[0],
				auth: undefined,
				origin: 'ci'
			};
			return {
				id: config.id,
				host: config.host,
				headers: {},
				url: rule.build('', ref)
			};
		}

		// Handle standard package with optional scope and version
		const spec = id.split('@');
		const name = id.startsWith('@') ? `@${spec[1]}` : spec[0];
		const version = id.startsWith('@') ? spec[2] : spec[1];
		if (!version) throw new Error(`Missing version in: ${id}`);

		const config = this.registries.resolve(name);
		if (!config) throw new Error(`Cannot resolve registry for: ${name}`);

		const rule = rules.get(config.id);
		if (!rule) throw new Error(`No rules found for registry: ${config.id}`);
		if (!config.auth) throw new Error(`Missing auth for: ${config.host}`);

		return {
			id: config.id,
			host: config.host,
			headers: rule.headers(config.auth),
			url: rule.build(name.startsWith('@') ? name.split('/')[0] : '', name) + `-${version}.tgz`
		};
	}
}
