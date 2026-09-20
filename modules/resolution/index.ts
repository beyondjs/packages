import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IPinParams, IGraphDocument } from './types';
import { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import { PackageProviders, Metadata } from '@beyond-js/packages/providers';
import { Roots } from './roots';
import { Document } from './document';

/**
 * First stage of a published build: pins the package/version graph of an application.
 *
 * It reads provider metadata only. It never downloads an archive and never reads source code: fetching
 * the pinned packages is the job of `@beyond-js/packages/sources`, and tracing what an application
 * reaches belongs to the analysis stage.
 */
export /*bundle*/ class Resolution {
	/**
	 * Resolves the roots into a `beyond-graph/1` document: every release with its origin, visibility,
	 * integrity and archive URL, the edges between them, and the diagnostics of what could not be pinned.
	 *
	 * Failures are returned in `diagnostics` (see `Resolution.valid`); the call only rejects
	 * on a programming error. The same roots, overrides, lock, targets and provider metadata give the
	 * same document and digest, whatever order the inputs were given in.
	 */
	static async pin(params: IPinParams): Promise<IGraphDocument> {
		if (!params || typeof params !== 'object') throw new Error('Resolution parameters are required');
		const { targets, overrides, lock, development, passes, logger } = params;

		const metadata = Resolution.#metadata(params);
		const roots = new Roots(params.roots, metadata);

		const graph = new DependenciesGraph(roots, { overrides, lock, development, passes, logger });
		await graph.process({ update: false });

		const document = new Document(graph, roots, Array.isArray(targets) ? targets : []);
		return document.write(graph, lock);
	}

	/**
	 * Whether a graph can be fetched and built: none of its diagnostics is an error. The document has no
	 * flag of its own, because its members are fixed by the `beyond-graph/1` schema.
	 */
	static valid(document: IGraphDocument): boolean {
		return !!document?.diagnostics && !document.diagnostics.some(({ severity }) => severity === 'error');
	}

	/**
	 * The metadata source of a resolution. Settings given as plain options are isolated from the host:
	 * its rc files and environment are read only when the options ask for them, so the credentials of
	 * whoever runs the service never reach the graph of a tenant.
	 */
	static #metadata({ providers, tenant, store }: IPinParams): IPackageProviders {
		const given: any = providers;
		if (given && typeof given.versions === 'function' && typeof given.manifest === 'function') return given;
		if (given instanceof PackageProviders) return new Metadata(given, { tenant, store });

		const isolated = { user: <const>false, global: <const>false, env: <const>false, ...(given || {}) };
		return new Metadata(new PackageProviders(isolated), { tenant, store });
	}
}
