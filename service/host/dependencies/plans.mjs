import { DependencyError } from './error.mjs';
import { Snapshot } from './snapshot.mjs';
import { Draft } from './draft.mjs';
import { Graph } from './graph.mjs';
import { Comparison } from './comparison.mjs';
import { Findings } from './findings.mjs';
import { Impact } from './impact.mjs';
import { PlanStore } from './store.mjs';

/**
 * A plan of explicit changes (`POST /dependencies/plans`, operation `dependencies.plan`): the whole workspace
 * resolved with the current lock as preferences except for what the changes release, with the manifest edits applied
 * in memory, and compared with the current graph. Nothing is written but the plan itself
 * (`.beyond/dependencies/plans/<id>.json`).
 *
 * When a requested change is blocked by a peer requirement (`PEER_INCOMPATIBLE`, `PEER_MISSING`, or a requested
 * version the graph did not select), the packages that require a requested package as a peer are released too and the
 * workspace is resolved once more; the second resolution is kept only when it has fewer errors, and the packages it
 * released are the plan's `peer` changes. `install --update` is never how a plan resolves.
 *
 * Steps: `draft` (the edits, counted), `resolve` (the metadata requests counted, the package asked about as the
 * current item), `compare` (the nodes of the proposed graph counted).
 */
export class Plans {
	static KIND = 'dependencies.plan';
	static STEPS = Object.freeze([
		{ id: 'draft', expected: { median: 100, p90: 500 } },
		{ id: 'resolve', expected: { median: 8000, p90: 30000 } },
		{ id: 'compare', expected: { median: 300, p90: 2000 } }
	]);
	static #PEERS = ['PEER_INCOMPATIBLE', 'PEER_MISSING'];

	#host;
	#store;

	/**
	 * @param {import('./host.mjs').Host} host
	 * @param {PlanStore} store
	 */
	constructor(host, store) {
		this.#host = host;
		this.#store = store;
	}

	/**
	 * The refusal of a plan or an application made against another state of the workspace
	 */
	static stale(base, current) {
		const message = 'The lock or the declared dependencies changed since this was read: read the dependencies again and plan again';
		return new DependencyError('PLAN_STALE', message, { base, current });
	}

	/**
	 * @param {import('../operations/operation.mjs').Operation} operation
	 * @param {{changes: import('./changes.mjs').Changes, base: {lock: string, inputs: string}}} request
	 */
	async run(operation, { changes, base }) {
		const snapshot = await this.#host.snapshot();
		if (!Snapshot.same(snapshot.base, base)) throw Plans.stale(base, snapshot.base);

		const drafting = operation.step('draft').begin({ phase: 'draft' });
		const draft = await new Draft(snapshot, changes).compose();
		drafting.count(draft.edits.length, draft.edits.length, 'edits').done();

		const resolving = operation.step('resolve').begin({ phase: 'resolution' });
		const resolved = await this.#resolve(operation, snapshot, draft, resolving);
		resolving.done();

		const comparing = operation.step('compare').begin({ phase: 'compare' });
		const { resolution } = resolved;
		const current = new Graph(snapshot.lock.document ?? {});
		// A resolution that answered no graph (it ran out of time, or failed) changes nothing it could show
		const answered = !!resolution.graph;
		const proposed = answered ? new Graph(resolution.graph) : current;
		const comparison = new Comparison(current, proposed, { requested: draft.requested, peers: resolved.peers });
		const findings = new Findings({ resolution, draft, current, proposed, comparison });
		const impact = await Impact.compose({
			current,
			proposed,
			edits: draft.edits,
			importers: snapshot.importers,
			workspace: this.#host.hosted,
			applications: this.#host.applications
		});
		comparing.count(proposed.nodes.size, proposed.nodes.size, 'nodes').done();

		const plan = {
			protocol: 'beyond-dependencies/1',
			id: PlanStore.id(),
			created: new Date().toISOString(),
			operation: operation.id,
			changes: changes.list,
			base: snapshot.base,
			proposed: { lock: resolution.lock ?? null, inputs: draft.inputs },
			valid: findings.valid && answered,
			edits: draft.edits,
			changed: comparison.changed,
			added: comparison.added,
			removed: comparison.removed,
			preserved: answered ? comparison.preserved : { count: 0 },
			diagnostics: findings.list,
			contexts: findings.contexts,
			affected: impact.toJSON(),
			work: { resolution: { milliseconds: resolved.milliseconds, requests: resolved.requests, attempts: resolved.attempts }, released: resolved.peers },
			preferences: resolved.preferences
		};
		await this.#store.write(plan);
		return plan;
	}

	/**
	 * Resolves the edited workspace with the plan's preferences, and once more releasing the peers that block a
	 * requested change
	 */
	async #resolve(operation, snapshot, draft, step) {
		const installation = await this.#host.installation(draft.params);
		let started = 0;
		const progress = ({ request }) => {
			if (request?.kind !== 'metadata' || request.answered) return;
			step.count(++started, undefined, 'requests').current(Plans.#package(request.url));
		};
		const attempt = async peers => {
			const preferences = draft.preferences(peers);
			const resolution = await installation.resolve({ preferences, names: draft.requested, signal: operation.signal, progress });
			if (operation.signal.aborted) throw operation.signal.reason;
			return { resolution, preferences, peers };
		};

		const first = await attempt([]);
		const peers = this.#blocking(first.resolution, snapshot, draft);
		if (!peers.length) return { ...first, attempts: 1, requests: first.resolution.requests, milliseconds: first.resolution.duration };

		const second = await attempt(peers);
		const errors = ({ resolution }) => resolution.diagnostics.filter(({ severity }) => severity === 'error').length;
		const chosen = errors(second) < errors(first) ? second : { ...first, peers: [] };
		const requests = first.resolution.requests + second.resolution.requests;
		return { ...chosen, attempts: 2, requests, milliseconds: first.resolution.duration + second.resolution.duration };
	}

	/**
	 * The packages to release when a peer requirement blocks the plan: the packages whose peer requirement failed, as
	 * the resolution's diagnostics name them; when a requested version was not selected without such a diagnostic,
	 * every package that requires a requested package as a peer, in the current graph or in the first resolution.
	 * Members are never released: they are not selected, they are on disk.
	 */
	#blocking(resolution, snapshot, draft) {
		const proposed = new Graph(resolution.graph ?? {});
		const current = new Graph(snapshot.lock.document ?? {});
		const requested = new Set(draft.requested);
		const releasable = (key, graph) => !!key && !key.startsWith('workspace:') && !requested.has(graph.node(key)?.name);

		const failed = resolution.diagnostics.filter(({ code, node }) => Plans.#PEERS.includes(code) && node);
		const named = failed.map(({ node }) => [node, [proposed, current].find(graph => graph.has(node))]).filter(([key, graph]) => graph && releasable(key, graph));
		if (named.length) return [...new Set(named.map(([key, graph]) => graph.node(key).name))].sort();

		const selected = ({ name, version }) => proposed.keys(name).some(key => proposed.node(key)?.version === version);
		if (!draft.pins.some(pin => !selected(pin))) return [];
		const names = new Set();
		for (const graph of [current, proposed]) {
			for (const [key, node] of graph.nodes) {
				releasable(key, graph) && graph.out(key).some(edge => edge.kind === 'peer' && requested.has(graph.named(edge))) && names.add(node.name);
			}
		}
		return [...names].sort();
	}

	/**
	 * The package a metadata request asks about: the last segment of its path, decoded (`@scope%2Fname`)
	 */
	static #package(url) {
		try {
			const segments = new URL(url).pathname.split('/').filter(Boolean);
			return decodeURIComponent(segments[segments.length - 1] ?? '');
		} catch {
			return void 0;
		}
	}
}
