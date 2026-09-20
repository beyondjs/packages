import type { Project } from '../..';
import type { ILockFile } from '../lockfile';
import type { ISourcesReport } from '@beyond-js/packages/sources';
import { Sources, FilesystemStore } from '@beyond-js/packages/sources';
import { join } from 'path';

/**
 * Downloads the packages of a lock file into the local source store.
 *
 * It delegates to `Sources`: the archive of each release is the one its registry published (never a URL
 * built from the package name), its integrity is verified before anything is stored, its size and
 * entries are bounded, and a release obtained with credentials is stored as private.
 */
export /*bundle*/ class DependenciesDownloader {
	readonly #project: Project;

	#report?: ISourcesReport;
	/**
	 * What the last download did: fetched and reused packages, and the diagnostics of those that failed
	 */
	get report() {
		return this.#report;
	}

	constructor(project: Project) {
		this.#project = project;
	}

	/**
	 * Where sources are kept: BEYOND_SOURCES_DIR, or the cache directory of the user
	 */
	async #root(): Promise<string> {
		if (process.env.BEYOND_SOURCES_DIR) return process.env.BEYOND_SOURCES_DIR;

		// As BeyondJS transpiles to CJS, we need to use dynamic import
		const envpaths = (await import('env-paths')).default;
		return join(envpaths('beyond-js').cache, 'sources');
	}

	async process(lockfile: ILockFile): Promise<ISourcesReport> {
		// The lock file describes each release as the graph pinned it: it is fetched as a graph
		const nodes: Record<string, any> = {};
		const diagnostics: { code: string; message: string; severity: 'error' }[] = [];

		for (const entry of Object.values(lockfile || {})) {
			const { name, version, dist, provider } = entry;
			if (!dist?.tarball || !provider) {
				const message = `The lock entry of "${name}@${version.resolved}" does not pin an archive: install again`;
				diagnostics.push({ code: 'LOCK_ENTRY_INCOMPLETE', message, severity: 'error' });
				continue;
			}

			nodes[`${provider.registry}:${name}@${version.resolved}`] = {
				name,
				version: version.resolved,
				origin: { provider: provider.registry, registry: provider.base },
				visibility: provider.visibility,
				integrity: dist.integrity,
				tarball: dist.tarball
			};
		}

		const graph: any = { protocol: 'beyond-graph/1', digest: 'local-install', nodes, exceptions: [], diagnostics };
		const store = new FilesystemStore(await this.#root());

		// A local installation has a single tenant: what needs credentials is stored for it alone
		this.#report = await Sources.fetch(graph, store, {}, 'local', this.#project.packages.providers);
		return this.#report;
	}
}
