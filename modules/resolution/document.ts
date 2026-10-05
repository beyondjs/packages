import type { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import type { Roots } from './roots';
import type { IGraphDocument, IGraphNode, IGraphRoot } from './types';
import { Canonical } from './canonical';
import { Traversal } from './traversal';

/**
 * Writes a processed dependency graph as a `beyond-graph/1` document. Occurrences become edges, the
 * releases they resolved to become nodes, and everything is emitted in a canonical order so that the
 * digest only depends on what was pinned.
 */
export class Document {
	#traversal: Traversal;
	#roots: IGraphRoot[] = [];

	constructor(graph: DependenciesGraph, roots: Roots, targets: string[]) {
		const traversal = (this.#traversal = new Traversal(graph));

		for (const { name, range, targets: own } of roots.list) {
			const node = graph.dependencies.get(name);
			if (!node) {
				// A development root is only a selection when build dependencies were requested
				const message = `Root "${name}" is a development dependency and was not requested to be followed`;
				traversal.diagnose({ code: 'ROOT_NOT_FOLLOWED', message, severity: 'warning' });
				continue;
			}

			const key = traversal.releases.key(node);
			const selected = [...new Set(own || targets)].sort();

			const root: IGraphRoot = { name, range };
			if (key) root.node = key;
			if (selected.length) root.targets = selected;
			this.#roots.push(root);
		}

		roots.diagnostics.forEach(diagnostic => traversal.diagnose(diagnostic));
		if (!this.#roots.length) {
			traversal.diagnose({
				code: 'ROOTS_REQUIRED',
				message: 'A resolution requires at least one root',
				severity: 'error'
			});
		}
	}

	/**
	 * The document, with the digest of its canonical form
	 *
	 * @param lock The lock the graph was resolved with: its digest is recorded when the lock pinned releases
	 */
	write(graph: DependenciesGraph, lock: any): IGraphDocument {
		const traversal = this.#traversal;
		const reused = !!graph.policy?.lock.size;
		const pinned = reused && typeof lock?.digest === 'string' && /^sha256-[0-9a-f]{64}$/.test(lock.digest);

		const content = {
			protocol: <const>'beyond-graph/1',
			roots: this.#roots,
			// A pinned graph never holds a member of a workspace: a `workspace:` source is refused before
			nodes: <Record<string, IGraphNode>>traversal.releases.sorted,
			edges: traversal.edges,
			overrides: traversal.overrides(graph),
			lock: pinned ? { reused, digest: lock.digest } : { reused },
			exceptions: traversal.exceptions,
			diagnostics: traversal.diagnostics
		};
		// Plain data only: a member without value is absent, not undefined
		const plain = JSON.parse(JSON.stringify(content));
		return { ...plain, digest: Canonical.digest(plain) };
	}
}
