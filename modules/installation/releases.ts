import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IReleases, IReleasesOptions } from './types';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { valid, rcompare } from 'semver';

// The codes a registry answers when it refuses the credential, or asks for one it was not given
const DENIED = ['PROVIDER_AUTH_REQUIRED', 'PROVIDER_AUTH_DENIED'];

/**
 * The releases the configured providers publish for some names: one package document per name, read through the
 * metadata of an installation (its cache, its transport and its bounds), with the registry that serves the name and
 * how it could be read. A name that cannot be read is answered with why, never by rejecting.
 */
export class Releases {
	/**
	 * Names read at once
	 */
	static CONCURRENCY = 6;

	#metadata: IPackageProviders;
	#signal?: AbortSignal;

	/**
	 * @param metadata The metadata of the installation, which a resolution may already have read
	 * @param signal Aborting it leaves the names not read yet answered as cancelled
	 */
	constructor(metadata: IPackageProviders, signal?: AbortSignal) {
		this.#metadata = metadata;
		this.#signal = signal;
	}

	/**
	 * The releases of each name, in the order given, each name once
	 */
	async read(names: string[], progress?: IReleasesOptions['progress']): Promise<IReleases[]> {
		const unique = [...new Set(names.filter(name => typeof name === 'string' && !!name))];
		const answered: Map<string, IReleases> = new Map();
		let next = 0;
		const worker = async () => {
			while (next < unique.length) {
				const name = unique[next++];
				answered.set(name, await this.#one(name));
				try {
					progress?.({ name, done: answered.size, total: unique.length });
				} catch {
					// Whoever listens never changes what is read
				}
			}
		};
		const workers = Math.min(Releases.CONCURRENCY, unique.length);
		await Promise.all(Array.from({ length: workers }, worker));
		return unique.map(name => answered.get(name));
	}

	/**
	 * The record of a name that was not read
	 */
	static unread(name: string, code: string, message: string): IReleases {
		const checked = new Date().toISOString();
		return { name, found: false, access: 'unknown', versions: [], tags: {}, deprecated: {}, checked, error: { code, message } };
	}

	async #one(name: string): Promise<IReleases> {
		if (this.#signal?.aborted) return Releases.unread(name, 'RESOLUTION_CANCELLED', 'The check was cancelled before this package was read');

		let identity: { base?: string; visibility?: string } | undefined;
		try {
			identity = await this.#metadata.describe?.(new DependencySource(name, '0.0.0'));
		} catch {
			// A name the settings cannot route is answered by the package document's own error below
		}
		let response: { error?: { code: string; message: string }; found?: boolean; packument?: any };
		try {
			response = await this.#metadata.packument(name);
		} catch (error) {
			response = { error: { code: 'PACKAGE_VERSIONS_FAILED', message: `The versions of "${name}" could not be obtained` } };
		}

		const checked = new Date().toISOString();
		const registry = identity?.base ? `${identity.base.replace(/\/$/, '')}/` : void 0;
		const located = registry ? { registry } : {};
		const { error, found, packument } = response || {};
		if (error) {
			const access = DENIED.includes(error.code) ? 'denied' : 'unknown';
			return { name, found: false, ...located, access, versions: [], tags: {}, deprecated: {}, checked, error: { code: error.code, message: error.message } };
		}
		if (!found || !packument) {
			const where = registry ? ` in ${registry}` : '';
			const missing = { code: 'PACKAGE_NOT_FOUND', message: `There is no package "${name}"${where}` };
			return { name, found: false, ...located, access: 'unknown', versions: [], tags: {}, deprecated: {}, checked, error: missing };
		}

		const published = packument.versions && typeof packument.versions === 'object' ? packument.versions : {};
		const versions = Object.keys(published).filter(version => !!valid(version)).sort(rcompare);
		const tags: Record<string, string> = {};
		const given = packument['dist-tags'];
		given && typeof given === 'object' && Object.entries(given).forEach(([tag, version]) => typeof version === 'string' && (tags[tag] = version));
		const deprecated: Record<string, string> = {};
		versions.forEach(version => {
			const message = published[version]?.deprecated;
			if (typeof message === 'string' && message) deprecated[version] = message;
		});
		const access = identity?.visibility === 'private' ? 'private' : 'public';
		// A release the toolchain added names its toolchain archive address instead of a registry's
		const supplied = versions.filter(version => String(published[version]?.dist?.tarball ?? '').startsWith('toolchain:'));
		const carried = supplied.length ? { supplied } : {};
		return { name, found: true, ...located, access, versions, tags, deprecated, ...carried, checked };
	}
}
