import semver from 'semver';
import { Checks } from './checks.mjs';
import { Snapshot } from './snapshot.mjs';

// What a person can do about a dependency no source provides to an installed graph
const ROUTES = Object.freeze({
	member: 'Declare a member that provides it: a directory of the workspace (package.json "workspaces", "beyond.workspaces" or the "packages" of beyond.json)',
	registry: 'Configure a registry that publishes it, in the .npmrc of the workspace or of the user, with the credential it needs',
	development: 'Keep developing without an installed graph: the development service supplies it to live development'
});

/**
 * Whether every dependency the workspace declares has a source an installation can use, asked before an installation
 * is offered (`POST /dependencies/preflight`, operation `dependencies.preflight`): for each declaration of each
 * importer, a member that provides it, a configured registry that publishes a satisfying version, or nothing, and why.
 *
 * A package the toolchain supplies to live development (Widgets and its adapters, the development runtime) is not
 * published by any registry the workspace configures: an installed graph, and a clean CI machine, cannot use that
 * source. Such a declaration is a blocker (`PACKAGE_NOT_FOUND`) naming the importer, the range, that the toolchain
 * supplies it, and the routes on. A denied registry (`PROVIDER_AUTH_REQUIRED`, `PROVIDER_AUTH_DENIED`), a range no
 * published version satisfies (`VERSION_UNRESOLVED`) and one no member satisfies (`WORKSPACE_RANGE_UNSATISFIED`) are
 * blockers too; an unreachable registry is `unavailable` (nothing tells), an optional declaration that would fail is
 * `skipped` as an installation skips it, and a git, archive or path source is `unverified` (the installation checks
 * it). Nothing is written.
 */
export class Preflight {
	static KIND = 'dependencies.preflight';
	static STEPS = Object.freeze([
		{ id: 'declaration', expected: { median: 100, p90: 500 } },
		{ id: 'metadata', expected: { median: 4000, p90: 15000 } },
		{ id: 'evaluate', expected: { median: 100, p90: 500 } }
	]);

	#host;

	/**
	 * @param {import('./host.mjs').Host} host What the feature reads the workspace and creates installations with
	 */
	constructor(host) {
		this.#host = host;
	}

	/**
	 * @param {import('../operations/operation.mjs').Operation} operation
	 */
	async run(operation) {
		const declaration = operation.step('declaration').begin({ phase: 'declaration' });
		const snapshot = await this.#host.snapshot();
		const declared = snapshot.importers.flatMap(importer => Snapshot.declared(importer).map(entry => ({ importer: importer.id, ...entry })));
		const members = snapshot.declaration.members;
		const owned = new Set(members.map(({ name }) => name));
		const registry = declared.filter(entry => !owned.has(entry.name) && Checks.range(entry.range) !== undefined);
		const names = [...new Set(registry.map(entry => Preflight.#target(entry)))];
		declaration.count(declared.length, declared.length, 'dependencies').done();

		const metadata = operation.step('metadata').begin({ phase: 'metadata' }).count(0, names.length, 'packages');
		const installation = await this.#host.installation(snapshot.params);
		const progress = ({ name, done, total }) => metadata.count(done, total, 'packages').current(name);
		const releases = new Map((await installation.releases(names, { signal: operation.signal, progress })).map(item => [item.name, item]));
		if (operation.signal.aborted) throw operation.signal.reason;
		metadata.done();

		const evaluate = operation.step('evaluate').begin({ phase: 'evaluate' });
		const supplied = new Map(snapshot.supplied.map(one => [one.name, one]));
		const dependencies = declared.map(entry => {
			if (owned.has(entry.name)) return Preflight.#member(entry, members);
			if (Checks.range(entry.range) === undefined) return Preflight.#unverified(entry);
			return Preflight.#registry(entry, releases.get(Preflight.#target(entry)), supplied.get(Preflight.#target(entry)));
		});
		evaluate.count(dependencies.length, dependencies.length, 'dependencies').done();

		const count = status => dependencies.filter(one => one.status === status).length;
		const counts = { declared: dependencies.length, available: count('available'), blocked: count('blocked'), unavailable: count('unavailable'), skipped: count('skipped'), unverified: count('unverified') };
		return {
			protocol: 'beyond-dependencies/1',
			ready: counts.blocked === 0,
			checked: new Date().toISOString(),
			installation: { state: snapshot.installation.state },
			dependencies,
			counts
		};
	}

	/**
	 * The registry name a declaration asks for: its own, or the one an `npm:` alias names
	 */
	static #target({ name, range }) {
		const alias = /^npm:((?:@[^/]+\/)?[^@]+)@/.exec(range);
		return alias ? alias[1] : name;
	}

	static #entry({ importer, name, range, type }) {
		return { importer, name, range, type };
	}

	static #member(entry, members) {
		const wanted = entry.range.startsWith('workspace:') ? entry.range.slice('workspace:'.length) : entry.range;
		const candidates = members.filter(({ name }) => name === entry.name);
		const admitted = candidates.find(({ version }) => wanted === '*' || wanted === '^' || wanted === '~' || (semver.validRange(wanted) && semver.satisfies(version, wanted)));
		if (admitted) return { ...Preflight.#entry(entry), source: 'member', status: 'available', member: admitted.id, version: admitted.version };
		const versions = candidates.map(({ id, version }) => `${version} (${id})`).join(', ');
		const message = `${entry.importer} declares ${entry.name} ${entry.range}, and no member of that name satisfies it: ${versions}`;
		const finding = { code: 'WORKSPACE_RANGE_UNSATISFIED', message, recovery: ['Change the range to one a member satisfies, or change the version of the member'] };
		return { ...Preflight.#entry(entry), source: 'member', status: Preflight.#blocked(entry), finding };
	}

	static #unverified(entry) {
		const message = `${entry.name} ${entry.range} is not a registry range: the installation checks this source when it resolves it`;
		return { ...Preflight.#entry(entry), source: 'unverified', status: 'unverified', finding: { code: 'SOURCE_UNVERIFIED', message } };
	}

	/**
	 * An optional dependency that cannot be resolved is skipped by an installation; any other one blocks it
	 */
	static #blocked({ type }) {
		return type === 'optional' ? 'skipped' : 'blocked';
	}

	static #registry(entry, releases, supplied) {
		const base = { ...Preflight.#entry(entry), ...(releases?.registry ? { registry: releases.registry } : {}), access: releases?.access ?? 'unknown' };
		const range = Checks.range(entry.range);
		const said = `${entry.importer} declares ${entry.name} ${entry.range}`;
		if (releases?.found) {
			const satisfying = releases.versions.filter(version => semver.satisfies(version, range));
			// A version only the Beyond toolchain carries is installed from its archives, which this machine has
			if (satisfying.length && releases.supplied?.includes(satisfying[0])) {
				return { ...base, source: 'toolchain', status: 'available', version: satisfying[0], satisfying: satisfying.length };
			}
			if (satisfying.length) return { ...base, source: 'registry', status: 'available', version: satisfying[0], satisfying: satisfying.length };
			const highest = releases.versions[0] ? `the highest it publishes is ${releases.versions[0]}` : 'it publishes no version';
			const finding = { code: 'VERSION_UNRESOLVED', message: `${said}, and ${releases.registry ?? 'its registry'} publishes no version that satisfies it: ${highest}`, recovery: ['Change the range to a published version'] };
			return { ...base, source: 'registry', status: Preflight.#blocked(entry), finding };
		}
		const code = releases?.error?.code ?? 'PACKAGE_NOT_FOUND';
		if (releases?.access === 'denied') {
			const finding = { code, message: `${said}, and ${releases.registry ?? 'its registry'} refused to answer: ${releases.error.message}`, recovery: ['Give the registry the credential it needs, in the .npmrc of the workspace or of the user'] };
			return { ...base, source: 'registry', status: Preflight.#blocked(entry), finding };
		}
		if (code !== 'PACKAGE_NOT_FOUND') {
			const finding = { code, message: `${said}, and whether ${releases?.registry ?? 'its registry'} publishes it cannot be told now: ${releases?.error?.message ?? 'no answer'}`, recovery: ['Check the connection to the registry and run the preflight again'] };
			return { ...base, source: 'registry', status: 'unavailable', finding };
		}
		if (supplied) {
			const message =
				`${said}, which only the toolchain supplies (${supplied.name}@${supplied.version}), for live development. No registry the ` +
				`workspace configures publishes it, so an installed graph and a clean CI machine cannot use that source`;
			const finding = { code, message, supplied: { name: supplied.name, version: supplied.version }, recovery: [ROUTES.member, ROUTES.registry, ROUTES.development] };
			return { ...base, source: 'supplied', status: Preflight.#blocked(entry), finding };
		}
		const message = `${said}, and no member provides it nor does ${releases?.registry ?? 'any configured registry'} publish it`;
		return { ...base, source: 'none', status: Preflight.#blocked(entry), finding: { code, message, recovery: [ROUTES.member, ROUTES.registry] } };
	}
}
