import semver from 'semver';
import { Graph } from './graph.mjs';
import { Snapshot } from './snapshot.mjs';

// The edge kind a manifest group's type becomes in a graph
const KINDS = Object.freeze({ prod: 'dependency', dev: 'build', peer: 'peer', optional: 'optional' });

/**
 * The dependencies of the workspace as dependency management shows them (`GET /dependencies`): the installed or
 * locked graph (the lock), what every importer declares now, and the packages the toolchain supplies, as one graph
 * of nodes. Read-only and local: nothing is requested from a registry.
 *
 * - A node of the lock keeps its key (`npm:react@19.1.1`, `workspace:apps/web`, `git:…`, `digest:…`). A dependency
 *   declared now that the lock does not hold is `declared:<name>`, one the toolchain supplies is
 *   `supplied:<name>@<version>` (never a member nor a node of the installed graph), and one a member provides is that
 *   member's node.
 * - `status` is `installed` (the projection locates it), `locked` (the lock holds it, the projection does not),
 *   `supplied`, `declared` (nothing resolved it yet) or `missing` (its sources are gone, or the lock skipped it).
 * - `source` says where its sources come from, one frame for each fact: `member` (the workspace, the only packages in
 *   development), `supplied` (the toolchain, `from: 'toolchain'` for a Beyond package it compiles and serves,
 *   `from: 'installation'` for a library its installation resolves, such as React, with the version installed there),
 *   or a registry, Git, an archive or a snapshot for a node of the lock.
 * - `declared` lists what each importer declares now for the node's name; `dependencies` and `dependents` are the
 *   edges of the graph, the lock's and those of declarations the lock does not hold yet.
 */
export class Inventory {
	/**
	 * Nodes an answer lists at most
	 */
	static LIMIT = 5000;

	#snapshot;
	#graph;
	#declared = new Map();

	/**
	 * @param {import('./snapshot.mjs').Snapshot} snapshot
	 */
	constructor(snapshot) {
		this.#snapshot = snapshot;
		this.#graph = new Graph(snapshot.lock.document ?? {});
		this.#build();
	}

	get graph() {
		return this.#graph;
	}

	get snapshot() {
		return this.#snapshot;
	}

	#build() {
		const graph = this.#graph;
		const snapshot = this.#snapshot;
		const owned = new Set(snapshot.declaration.members.map(({ name }) => name));
		for (const { id, name, version } of snapshot.importers) {
			const key = `workspace:${id}`;
			graph.has(key) || graph.add(key, { name, version, origin: { provider: 'workspace' }, member: id, visibility: 'public', integrity: null, tarball: null });
			graph.members[id] ??= { name, version, node: key };
		}
		for (const { name, version, library } of snapshot.supplied) {
			const origin = { provider: 'supplied', from: library ? 'installation' : 'toolchain' };
			!owned.has(name) && graph.add(`supplied:${name}@${version}`, { name, version, origin });
		}

		for (const importer of snapshot.importers) {
			const from = graph.members[importer.id]?.node ?? `workspace:${importer.id}`;
			for (const { name, range, type } of Snapshot.declared(importer)) {
				const edges = graph.out(from).filter(edge => graph.named(edge) === name);
				const edge = edges.find(one => Graph.type(one.kind) === type) ?? edges[0];
				let target = edge?.to;
				if (edge && typeof target !== 'string') target = this.#placeholder(name, true);
				if (!edge) {
					target = this.#target(name, range, owned);
					graph.link({ from, to: target, kind: KINDS[type], range, declared: true });
				}
				const list = this.#declared.get(target) ?? [];
				list.push({ importer: importer.id, range, type });
				this.#declared.set(target, list);
			}
		}
	}

	/**
	 * Where a declaration the lock does not hold leads: the member that provides the name (one whose version the
	 * range admits, when there is one), the package the toolchain supplies, or a node of its own
	 */
	#target(name, range, owned) {
		if (owned.has(name)) {
			const members = this.#snapshot.declaration.members.filter(member => member.name === name);
			const wanted = range.startsWith('workspace:') ? range.slice('workspace:'.length) : range;
			const admitted = members.find(({ version }) => semver.validRange(wanted) && semver.satisfies(version, wanted));
			return `workspace:${(admitted ?? members[0]).id}`;
		}
		const supplied = this.#snapshot.supplied.find(one => one.name === name);
		if (supplied) return `supplied:${supplied.name}@${supplied.version}`;
		return this.#placeholder(name, false);
	}

	/**
	 * The node of a declared name that nothing resolved: skipped by the lock (an optional dependency that could not
	 * be pinned), or not resolved yet
	 */
	#placeholder(name, skipped) {
		const key = `declared:${name}`;
		const known = this.#graph.node(key);
		if (known) {
			known.skipped ||= skipped;
			return key;
		}
		this.#graph.add(key, { name, version: null, origin: { provider: 'declared' }, skipped });
		return key;
	}

	/**
	 * The source of a node: its kind, and the registry or the member it comes from
	 */
	static source(node) {
		const provider = String(node?.origin?.provider ?? '');
		if (provider === 'workspace') return { kind: 'member', member: node.member };
		if (provider === 'supplied') return { kind: 'supplied', from: node.origin.from ?? 'toolchain' };
		if (provider === 'declared') return { kind: 'declared' };
		// A release only the Beyond toolchain carries, installed from its archives
		if (provider === 'toolchain') return { kind: 'toolchain' };
		if (provider === 'npm') return { kind: 'registry', registry: node.origin.registry ?? 'https://registry.npmjs.org/' };
		if (provider.startsWith('registry-')) return { kind: 'registry', registry: node.origin.registry };
		if (provider.startsWith('git-')) return { kind: 'git', registry: node.origin.registry };
		if (provider === 'digest') return { kind: 'archive', ...(node.origin.registry ? { registry: node.origin.registry } : {}) };
		if (provider.startsWith('snapshot')) return { kind: 'snapshot', ...(node.origin.registry ? { registry: node.origin.registry } : {}) };
		return { kind: 'unknown' };
	}

	#missing() {
		const { diagnostics } = this.#snapshot.installation;
		return new Set(diagnostics.filter(({ code, node }) => code === 'SOURCE_MISSING' && node).map(({ node }) => node));
	}

	/**
	 * The status of a node (see the class)
	 */
	status(key, missing = this.#missing()) {
		const node = this.#graph.node(key);
		const kind = Inventory.source(node).kind;
		if (kind === 'supplied') return 'supplied';
		if (kind === 'declared') return node.skipped ? 'missing' : 'declared';
		if (missing.has(key)) return 'missing';
		if (this.#snapshot.execution?.node?.(key)) return 'installed';
		return this.#snapshot.lock.document?.nodes?.[key] ? 'locked' : 'declared';
	}

	/**
	 * One node as the inventory lists it
	 */
	node(key, missing = this.#missing()) {
		const graph = this.#graph;
		const node = graph.node(key);
		const edge = (one, other) => ({
			key: other,
			...(other === one.to ? { name: graph.named(one) } : {}),
			range: one.override ?? one.range,
			type: Graph.type(one.kind),
			...(one.context ? { context: one.context } : {}),
			...(one.skipped ? { skipped: one.skipped } : {})
		});
		const integrity = node.integrity !== undefined ? { integrity: node.integrity } : {};
		const visibility = node.visibility ? { visibility: node.visibility } : {};
		return {
			key,
			name: node.name,
			version: node.version ?? null,
			source: Inventory.source(node),
			declared: [...(this.#declared.get(key) ?? [])],
			dependencies: graph.out(key).map(one => edge(one, typeof one.to === 'string' ? one.to : null)),
			dependents: graph.in(key).map(one => edge(one, one.from)),
			status: this.status(key, missing),
			...integrity,
			...visibility
		};
	}

	/**
	 * The keys a scope covers: every node of the workspace, or the closures of a member or a node in both directions
	 *
	 * @param {import('./scope.mjs').Scope} scope
	 */
	keys(scope) {
		const start = scope.start(this.#graph);
		if (!start) return [...this.#graph.nodes.keys()];
		const keys = new Set([...this.#graph.closure(start, 'out'), ...this.#graph.closure(start, 'in')]);
		return [start, ...[...keys].filter(key => key !== start)];
	}

	/**
	 * The importers with what each one declares now
	 */
	get members() {
		return this.#snapshot.importers.map(importer => ({
			id: importer.id,
			name: importer.name,
			version: importer.version,
			node: this.#graph.members[importer.id]?.node ?? `workspace:${importer.id}`,
			...(importer.file ? { manifest: importer.file } : {}),
			...(importer.root ? { root: true } : {}),
			declared: Snapshot.declared(importer).map(({ name, range, type }) => ({ name, range, type }))
		}));
	}

	/**
	 * The document `GET /dependencies` answers for a scope
	 *
	 * @param {import('./scope.mjs').Scope} scope
	 */
	describe(scope) {
		const snapshot = this.#snapshot;
		const keys = this.keys(scope);
		const missing = this.#missing();
		const shown = keys.slice(0, Inventory.LIMIT);
		const nodes = shown.map(key => this.node(key, missing));
		const { lock } = snapshot;
		return {
			protocol: 'beyond-dependencies/1',
			scope: scope.toJSON(),
			installation: snapshot.installation,
			lock: { present: lock.present, digest: lock.digest ?? null, ...(lock.problem ? { problem: lock.problem } : {}) },
			inputs: { digest: snapshot.inputs },
			base: snapshot.base,
			members: this.members,
			nodes,
			counts: { members: snapshot.importers.length, nodes: this.#graph.nodes.size, scope: keys.length, shown: nodes.length },
			truncated: keys.length > shown.length,
			diagnostics: snapshot.declaration.diagnostics
		};
	}
}
