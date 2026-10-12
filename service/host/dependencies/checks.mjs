import semver from 'semver';
import { Inventory } from './inventory.mjs';

/**
 * The check of the versions a scope's packages could have (`POST /dependencies/checks`, operation
 * `dependencies.check`): for every registry node of the scope, and every registry dependency declared and not
 * resolved yet, what the configured provider publishes now. Read-only: the lock, the manifests and the projection are
 * never touched.
 *
 * Each node answers `{key, name, current, ranges, wanted, latest, available, deprecated?, registry, access, checked,
 * error?}`: `current` is the version the lock holds (null for a declaration not resolved yet), `wanted` the highest
 * published version every range that selects the node admits, `latest` the `latest` distribution tag, `available` the
 * newest published versions (at most `AVAILABLE`), and `access` how the provider could be read (`public`, `private`,
 * `denied`, `unknown`). Its steps are `metadata` (one count per package, the package being read as its current item)
 * and `compare`.
 */
export class Checks {
	static KIND = 'dependencies.check';
	static AVAILABLE = 20;
	static STEPS = Object.freeze([
		{ id: 'metadata', expected: { median: 4000, p90: 15000 } },
		{ id: 'compare', expected: { median: 200, p90: 1000 } }
	]);

	#host;

	/**
	 * @param {import('./host.mjs').Host} host What the feature reads the workspace and creates installations with
	 */
	constructor(host) {
		this.#host = host;
	}

	/**
	 * The work of a check operation
	 *
	 * @param {import('../operations/operation.mjs').Operation} operation
	 * @param {import('./scope.mjs').Scope} scope Already validated against the workspace
	 */
	async run(operation, scope) {
		const snapshot = await this.#host.snapshot();
		const inventory = new Inventory(snapshot);
		const nodes = inventory.keys(scope).map(key => inventory.node(key)).filter(node => Checks.#checkable(node));
		const names = [...new Set(nodes.map(node => Checks.#package(node)))];

		const metadata = operation.step('metadata').begin({ phase: 'metadata' }).count(0, names.length, 'packages');
		const installation = await this.#host.installation(snapshot.params);
		const progress = ({ name, done, total }) => metadata.count(done, total, 'packages').current(name);
		const releases = new Map((await installation.releases(names, { signal: operation.signal, progress })).map(item => [item.name, item]));
		if (operation.signal.aborted) throw operation.signal.reason;
		metadata.done();

		const compare = operation.step('compare').begin({ phase: 'compare' });
		const checked = nodes.map(node => Checks.#compare(node, releases.get(Checks.#package(node))));
		compare.count(checked.length, checked.length, 'nodes').done();

		const counts = {
			packages: names.length,
			nodes: checked.length,
			outdated: checked.filter(({ current, wanted }) => Checks.#newer(wanted, current)).length,
			behind: checked.filter(({ current, latest }) => Checks.#newer(latest, current)).length,
			denied: checked.filter(({ access }) => access === 'denied').length,
			failed: checked.filter(({ error }) => error).length
		};
		return { protocol: 'beyond-dependencies/1', scope: scope.toJSON(), checked: new Date().toISOString(), nodes: checked, counts };
	}

	/**
	 * Whether a node's versions come from a registry: a registry node of the lock, or a declaration not resolved
	 * yet whose range is a registry one
	 */
	static #checkable(node) {
		if (node.source.kind === 'registry') return true;
		if (node.source.kind !== 'declared') return false;
		return node.declared.some(({ range }) => Checks.range(range) !== undefined);
	}

	/**
	 * The package a node's versions are read for: its own name, or the one an `npm:` alias declares for a declaration
	 * not resolved yet (a resolved alias is a node of the aliased package already)
	 */
	static #package(node) {
		if (node.source.kind !== 'declared') return node.name;
		const alias = node.declared.map(({ range }) => /^npm:((?:@[^/]+\/)?[^@]+)@/.exec(range)?.[1]).find(name => name);
		return alias ?? node.name;
	}

	/**
	 * The semver range a declaration asks for, `npm:` aliases read as their range; undefined for a source that is no
	 * registry range (`workspace:`, git, an archive URL, a path)
	 */
	static range(range) {
		const text = typeof range === 'string' ? range.replace(/^npm:(@[^/]+\/)?[^@]+@/, '') : '';
		return semver.validRange(text) ? text : void 0;
	}

	static #newer(version, current) {
		return !!version && !!current && semver.valid(version) && semver.valid(current) && semver.gt(version, current);
	}

	/**
	 * What a node could have: the ranges that select it come from its dependents' edges, or from the declarations
	 * of a node not resolved yet
	 */
	static #compare(node, releases) {
		const declared = node.dependents.length ? node.dependents.map(({ range }) => range) : node.declared.map(({ range }) => range);
		const ranges = [...new Set(declared.map(range => Checks.range(range)).filter(range => range !== undefined))];
		const current = node.source.kind === 'declared' ? null : node.version;
		const base = { key: node.key, name: node.name, current, ranges };
		const checked = releases?.checked ?? new Date().toISOString();
		if (!releases?.found) {
			const error = releases?.error ?? { code: 'PACKAGE_NOT_FOUND', message: `"${node.name}" was not read` };
			return { ...base, wanted: null, latest: null, available: [], registry: releases?.registry ?? node.source.registry ?? null, access: releases?.access ?? 'unknown', checked, error };
		}

		const { versions, tags, deprecated } = releases;
		const wanted = versions.find(version => ranges.every(range => semver.satisfies(version, range))) ?? null;
		const message = current ? deprecated[current] : void 0;
		return {
			...base,
			wanted,
			latest: tags.latest ?? null,
			available: versions.slice(0, Checks.AVAILABLE),
			...(message ? { deprecated: message } : {}),
			registry: releases.registry ?? node.source.registry ?? null,
			access: releases.access,
			checked
		};
	}
}
