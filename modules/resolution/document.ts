import type { DependenciesGraph, Node } from '@beyond-js/packages/dependencies/graph';
import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import type { Roots } from './roots';
import type { IGraphDocument, IGraphNode, IGraphEdge, IGraphException, IGraphDiagnostic, IGraphRoot } from './types';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { Canonical } from './canonical';
import { Origin } from './origin';

const kinds: Record<DependencyKind, IGraphEdge['kind']> = {
	main: 'dependency',
	development: 'build',
	peer: 'peer',
	optional: 'optional'
};
const forms = ['source', 'distribution', 'npm'];
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Writes a processed dependency graph as a `beyond-graph/1` document. Occurrences become edges, the
 * releases they resolved to become nodes, and everything is emitted in a canonical order so that the
 * digest only depends on what was pinned.
 */
export class Document {
	#nodes: Map<string, IGraphNode> = new Map();
	#edges: Map<string, IGraphEdge> = new Map();
	#exceptions: Map<string, IGraphException> = new Map();
	#diagnostics: Map<string, IGraphDiagnostic> = new Map();
	#keys: Map<Node, string | null> = new Map();
	#roots: IGraphRoot[] = [];

	// Occurrences whose failure invalidates the graph, as the closure of the graph judged them
	#blocking: Set<string> = new Set();
	#judged = false;

	/**
	 * The key of the release an occurrence resolved to: `provider:name@version`. Null when it failed.
	 */
	#key(node: Node): string | null {
		if (this.#keys.has(node)) return this.#keys.get(node);

		const target = node.soft ? node.provider : node;
		const owner = target?.link || target;
		const failed = !owner || owner.error || target.error || !owner.version.resolved || !owner.release?.provider;
		if (failed) {
			this.#keys.set(node, null);
			return null;
		}

		const described = this.#describe(owner);
		const key = `${described.origin.provider}:${described.name}@${described.version}`;
		this.#keys.set(node, key);
		if (!this.#nodes.has(key)) this.#nodes.set(key, described);
		return key;
	}

	#describe(owner: Node): IGraphNode {
		const { source, version, release } = owner;
		const { visibility } = release.provider;
		const { data } = source;

		if (data.is === DependencySourceIsType.Url) {
			const origin = Origin.of('url', release.provider);
			const base = { name: owner.package, version: version.resolved, origin, visibility };
			return { ...base, integrity: data.integrity, tarball: data.url };
		}

		const manifest = release.manifest;
		const form = (<any>manifest)?.beyond?.publication?.form;
		const publication = forms.includes(form) ? { publication: form } : {};

		if (data.is === DependencySourceIsType.Git) {
			// The commit is what is pinned: it is kept as build metadata of the declared version
			const name = manifest?.name || owner.package;
			const pinned = `${manifest?.version || '0.0.0'}+git.${version.resolved}`;
			const origin = Origin.of('git', release.provider);
			return {
				name,
				version: pinned,
				origin,
				visibility,
				integrity: null,
				tarball: release.tarball,
				...publication
			};
		}

		const dist = manifest?.dist;
		const hex = typeof dist?.shasum === 'string' && /^[0-9a-f]{40}$/i.test(dist.shasum) ? dist.shasum : void 0;
		const integrity = dist?.integrity || (hex ? `sha1-${Buffer.from(hex, 'hex').toString('base64')}` : null);
		const origin = Origin.of('registry', release.provider);
		const base = { name: source.package, version: version.resolved, origin, visibility };
		return { ...base, integrity, tarball: this.#clean(dist?.tarball), ...publication };
	}

	/**
	 * An archive URL as it may be stored and shown: without user information
	 */
	#clean(url?: string): string | null {
		try {
			const parsed = new URL(url);
			parsed.username = '';
			parsed.password = '';
			return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
		} catch {
			return null;
		}
	}

	#diagnose(diagnostic: IGraphDiagnostic) {
		this.#diagnostics.set(Canonical.text(diagnostic), diagnostic);
	}

	/**
	 * Records what is exceptional about a pinned release
	 */
	#inspect(owner: Node, key: string) {
		const node = this.#nodes.get(key);
		const { provider } = node.origin;

		if (owner.release.via === 'manifest') {
			const reason = 'The provider publishes no package metadata; the manifest was fetched to read dependencies';
			this.#exceptions.set(key, { node: key, kind: 'manifest-fetch', provider, reason });
		}
		if (owner.source.data.is === DependencySourceIsType.Url) {
			const message = 'The dependencies of an archive URL are unknown until it is fetched: none was pinned';
			this.#diagnose({ code: 'URL_DEPENDENCIES_UNKNOWN', message, severity: 'warning', node: key });
		}

		const incomplete = (!node.integrity && !this.#exceptions.has(key)) || !node.tarball;
		if (!incomplete) return;
		const message = `The provider publishes no archive or no integrity for "${node.name}@${node.version}"`;
		this.#diagnose({ code: 'RELEASE_DIST_MISSING', message, severity: 'error', node: key });
	}

	/**
	 * The node a peer was provided in the context of. The root of an application is not a node: a peer
	 * that the root selections provide takes the root selection it was required through.
	 */
	#context(node: Node): string | null {
		let context = node.context;
		if (!context?.parent) for (context = node; context.parent?.parent; ) context = context.parent;
		return this.#key(context);
	}

	#edge(from: string, node: Node) {
		const to = this.#key(node);
		const path = node.id.split('>').slice(1).join(' > ');
		const error = node.error || (node.soft ? void 0 : node.link?.error);

		if (error) {
			// The closure decides: a failure is a warning only when it is reached through optional
			// dependencies alone
			const severity = this.#blocking.has(node.id) || !this.#judged ? 'error' : 'warning';
			const message = `${error.message} (required through ${path})`;
			this.#diagnose({ code: error.code, message, severity, node: from || void 0 });
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
			if (this.#nodes.get(to).name !== node.package) edge.name = node.package;
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
			const key = this.#key(child);
			if (key && !child.soft && !child.link) this.#inspect(child, key);

			// The selections of the root are listed as roots, not as edges: only their failures are read
			this.#edge(node.parent ? from : null, child);
			if (key && !child.soft) this.#walk(child, key, visited);
		}
	}

	constructor(graph: DependenciesGraph, roots: Roots, targets: string[]) {
		this.#judged = !!graph.closure;
		graph.closure?.errors.forEach(({ id }) => this.#blocking.add(id));
		this.#walk(graph, null, new Set());

		for (const { name, range, targets: own } of roots.list) {
			const node = graph.dependencies.get(name);
			if (!node) {
				// A development root is only a selection when build dependencies were requested
				const message = `Root "${name}" is a development dependency and was not requested to be followed`;
				this.#diagnose({ code: 'ROOT_NOT_FOLLOWED', message, severity: 'warning' });
				continue;
			}

			const key = this.#key(node);
			const selected = [...new Set(own || targets)].sort();

			const root: IGraphRoot = { name, range };
			if (key) root.node = key;
			if (selected.length) root.targets = selected;
			this.#roots.push(root);
		}

		roots.diagnostics.forEach(diagnostic => this.#diagnose(diagnostic));
		graph.diagnostics.forEach(({ code, message }) => this.#diagnose({ code, message, severity: 'error' }));
		graph.warnings.forEach(message => this.#diagnose({ code: 'RESOLUTION_WARNING', message, severity: 'warning' }));
		if (!this.#roots.length) {
			this.#diagnose({
				code: 'ROOTS_REQUIRED',
				message: 'A resolution requires at least one root',
				severity: 'error'
			});
		}

		// A release whose peers were provided differently depending on the dependent cannot be told
		// apart by its key: every context is recorded, and the ambiguity is reported
		const peers: Map<string, Set<string>> = new Map();
		for (const { from, to, kind, name } of this.#edges.values()) {
			if (kind !== 'peer' || !to) continue;
			const id = `${from}|${name || this.#nodes.get(to).name}`;
			peers.set(id, (peers.get(id) || new Set()).add(to));
		}
		for (const [id, provided] of peers) {
			if (provided.size < 2) continue;
			const [from, name] = id.split('|');
			const message = `The peer "${name}" is provided by ${provided.size} different releases depending on the context`;
			this.#diagnose({ code: 'PEER_CONTEXT_CONFLICT', message, severity: 'warning', node: from });
		}
	}

	write(graph: DependenciesGraph, lock: any): IGraphDocument {
		const nodes: Record<string, IGraphNode> = {};
		[...this.#nodes.keys()].sort().forEach(key => (nodes[key] = this.#nodes.get(key)));
		const sorted = <T>(items: Map<string, T>) => [...items.keys()].sort().map(key => items.get(key));

		const overrides = (graph.policy?.overrides.rules || [])
			.map(({ name, value, within }) => {
				const limited = within.length ? { within: within[within.length - 1] } : {};
				return { name, selection: value, ...limited };
			})
			.sort((a, b) => order(Canonical.text(a), Canonical.text(b)));

		const reused = !!graph.policy?.lock.size;
		const pinned = reused && typeof lock?.digest === 'string' && /^sha256-[0-9a-f]{64}$/.test(lock.digest);

		const content = {
			protocol: <const>'beyond-graph/1',
			roots: this.#roots,
			nodes,
			edges: sorted(this.#edges),
			overrides,
			lock: pinned ? { reused, digest: lock.digest } : { reused },
			exceptions: sorted(this.#exceptions),
			diagnostics: sorted(this.#diagnostics)
		};
		// Plain data only: a member without value is absent, not undefined
		const plain = JSON.parse(JSON.stringify(content));
		return { ...plain, digest: Canonical.digest(plain) };
	}
}
