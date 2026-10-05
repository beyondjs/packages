import type { DependenciesGraph, Node } from '@beyond-js/packages/dependencies/graph';
import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import type { IGraphNode, IGraphEdge, IGraphException, IGraphDiagnostic, IGraphOverride } from './types';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { Canonical } from './canonical';
import { Releases } from './releases';

const kinds: Record<DependencyKind, IGraphEdge['kind']> = {
	main: 'dependency',
	development: 'build',
	peer: 'peer',
	optional: 'optional'
};
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Walks a processed dependency graph from its root: the releases occurrences resolved to, the edges between
 * them, what is exceptional about each release and the diagnostics of every occurrence that failed. The pinned
 * graph of an application and the graph of a workspace are both written from it; what the root requires is
 * listed by each document in its own terms (roots, members), never as edges.
 */
export class Traversal {
	#releases = new Releases();
	/**
	 * The releases reached, keyed and described
	 */
	get releases() {
		return this.#releases;
	}

	#edges: Map<string, IGraphEdge> = new Map();
	#exceptions: Map<string, IGraphException> = new Map();
	#diagnostics: Map<string, IGraphDiagnostic> = new Map();

	// Occurrences whose failure invalidates the graph, as the closure of the graph judged them
	#blocking: Set<string> = new Set();
	#judged = false;

	constructor(graph: DependenciesGraph) {
		this.#judged = !!graph.closure;
		graph.closure?.errors.forEach(({ id }) => this.#blocking.add(id));
		this.#walk(graph, null, new Set());

		graph.diagnostics.forEach(({ code, message }) => this.diagnose({ code, message, severity: 'error' }));
		graph.warnings.forEach(message => this.diagnose({ code: 'RESOLUTION_WARNING', message, severity: 'warning' }));
		this.#conflicts();
	}

	/**
	 * The edges in canonical order
	 */
	get edges(): IGraphEdge[] {
		return this.#sorted(this.#edges);
	}

	/**
	 * What is exceptional about the releases, in canonical order
	 */
	get exceptions(): IGraphException[] {
		return this.#sorted(this.#exceptions);
	}

	/**
	 * Every diagnostic recorded, once each, in canonical order
	 */
	get diagnostics(): IGraphDiagnostic[] {
		return this.#sorted(this.#diagnostics);
	}

	/**
	 * The overrides in effect, with the innermost package each one is limited to
	 */
	overrides(graph: DependenciesGraph): IGraphOverride[] {
		return (graph.policy?.overrides.rules || [])
			.map(({ name, value, within }) => {
				const limited = within.length ? { within: within[within.length - 1] } : {};
				return { name, selection: value, ...limited };
			})
			.sort((a, b) => order(Canonical.text(a), Canonical.text(b)));
	}

	/**
	 * Records a diagnostic once, whatever the number of times it was found
	 */
	diagnose(diagnostic: IGraphDiagnostic) {
		this.#diagnostics.set(Canonical.text(diagnostic), diagnostic);
	}

	#sorted<T>(items: Map<string, T>): T[] {
		return [...items.keys()].sort().map(key => items.get(key));
	}

	/**
	 * Records what is exceptional about a pinned release. A member of a workspace is read from its directory: it
	 * has nothing of the sort.
	 */
	#inspect(owner: Node, key: string) {
		if (owner.release.member) return;
		const node = <IGraphNode>this.#releases.get(key);
		const { provider } = node.origin;

		if (owner.release.via === 'manifest') {
			const reason = 'The provider publishes no package metadata; the manifest was fetched to read dependencies';
			this.#exceptions.set(key, { node: key, kind: 'manifest-fetch', provider, reason });
		}
		if (owner.release.downloaded) {
			const reason = 'The archive URL declares no integrity; it was downloaded once to pin its content digest';
			this.#exceptions.set(key, { node: key, kind: 'archive-fetch', provider, reason });
		}
		if (owner.source.data.is === DependencySourceIsType.Url) {
			const message = 'The dependencies of an archive URL are unknown until it is fetched: none was pinned';
			this.diagnose({ code: 'URL_DEPENDENCIES_UNKNOWN', message, severity: 'warning', node: key });
		}

		const incomplete = (!node.integrity && !this.#exceptions.has(key)) || !node.tarball;
		if (!incomplete) return;
		const message = `The provider publishes no archive or no integrity for "${node.name}@${node.version}"`;
		this.diagnose({ code: 'RELEASE_DIST_MISSING', message, severity: 'error', node: key });
	}

	/**
	 * The node a peer was provided in the context of. The root of an application is not a node: a peer that the
	 * root selections provide takes the root selection it was required through.
	 */
	#context(node: Node): string | null {
		let context = node.context;
		if (!context?.parent) for (context = node; context.parent?.parent; ) context = context.parent;
		return this.#releases.key(context);
	}

	#edge(from: string, node: Node) {
		const to = this.#releases.key(node);
		const path = node.id.split('>').slice(1).join(' > ');
		const error = node.error || (node.soft ? void 0 : node.link?.error);

		if (error) {
			// The closure decides: a failure is a warning only when it is reached through optional
			// dependencies alone
			const severity = this.#blocking.has(node.id) || !this.#judged ? 'error' : 'warning';
			const message = `${error.message} (required through ${path})`;
			this.diagnose({ code: error.code, message, severity, node: from || void 0 });
		}
		if (!from) return;

		const declared = node.declared !== void 0;
		const edge: IGraphEdge = {
			from,
			to,
			kind: kinds[node.kind],
			range: declared ? node.declared : node.version.specified
		};
		if (declared) edge.override = node.version.specified;

		if (!to) {
			// Only an optional dependency may stay without a target; any other failure is an error above
			if (node.kind !== 'optional') return;
			edge.name = node.package;
			edge.skipped = error ? `${error.code}: ${error.message}` : 'The optional dependency could not be pinned';
		} else {
			if (this.#releases.get(to).name !== node.package) edge.name = node.package;
			if (node.soft) edge.context = this.#context(node);
			if (node.soft && !edge.context) return;
		}
		this.#edges.set(Canonical.text(edge), edge);
	}

	#walk(node: Node, from: string | null, visited: Set<Node>) {
		if (visited.has(node)) return;
		visited.add(node);

		for (const name of [...node.dependencies.keys()].sort()) {
			const child = node.dependencies.get(name);
			const key = this.#releases.key(child);
			if (key && !child.soft && !child.link) this.#inspect(child, key);

			// What the root requires is listed by the document, not as edges: only its failures are read
			this.#edge(node.parent ? from : null, child);
			if (key && !child.soft) this.#walk(child, key, visited);
		}
	}

	/**
	 * A release whose peers were provided differently depending on the dependent cannot be told apart by its
	 * key: every context is recorded, and the ambiguity is reported
	 */
	#conflicts() {
		const peers: Map<string, { from: string; name: string; provided: Set<string> }> = new Map();
		for (const { from, to, kind, name: declared } of this.#edges.values()) {
			if (kind !== 'peer' || !to) continue;
			const name = declared || this.#releases.get(to).name;
			const id = Canonical.text([from, name]);
			if (!peers.has(id)) peers.set(id, { from, name, provided: new Set() });
			peers.get(id).provided.add(to);
		}
		for (const { from, name, provided } of peers.values()) {
			if (provided.size < 2) continue;
			const message = `The peer "${name}" is provided by ${provided.size} different releases depending on the context`;
			this.diagnose({ code: 'PEER_CONTEXT_CONFLICT', message, severity: 'warning', node: from });
		}
	}
}
