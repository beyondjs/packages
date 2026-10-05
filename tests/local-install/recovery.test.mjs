/**
 * Acceptance of the owner's criteria 5 and 9 for installing a local workspace, at the level of Packages' public
 * contracts: when the execution projection is stale, missing, incompatible or incomplete and how a reinstall
 * recovers; what an installation can do offline; and failures — a package no registry has, a corrupt archive, an
 * interrupted transfer, an unreachable registry, local ranges and `workspace:` specifications nothing satisfies,
 * concurrent installations and abandoned stages — reported as invalid installations that wrote nothing. The
 * fixture is the acceptance workspace of `acceptance.test.mjs`; this directory's README describes both.
 *
 * Run from the Packages directory under BEE Node, with the bootstrap Engine serving this checkout and the utilities
 * (`BEE_URL`) and a BEE Node checkout (`BEE_NODE_DIR`), as `tests/stage-1/README.md` describes; no watchers service
 * is needed:
 *
 *     BEE_URL=http://localhost:1112,… node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/recovery.test.mjs
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Execution } from '@beyond-js/packages/execution';
import { Scenario } from './support/scenario.mjs';
import { Catalog } from './support/catalog.mjs';
import { Store } from './support/store.mjs';
import { Fixture } from './support/fixture.mjs';
import { Canonical } from './support/canonical.mjs';

const BOUND = { timeout: 180_000 };
const { MEMBERS, RELEASES, MANIFEST } = Fixture;
const { app: APP, app18: APP18, banner: BANNER, view: VIEW, message: MESSAGE, outside: MESSAGE2, root: ROOT } = Fixture.KEYS;
const codes = diagnostics => diagnostics.map(({ code }) => code);
const explain = value => JSON.stringify(value, null, 1);
const local = url => decodeURIComponent(url).includes('@lt/');


describe('freshness: stale, missing, incompatible and incomplete projections, and offline limits (criteria 5 and 9)', () => {
	const scenario = new Scenario('freshness');
	before(async () => {
		await scenario.open();
		const report = await scenario.workspace.install();
		assert.equal(report.valid, true, explain(report.diagnostics));
	});
	after(() => scenario.close());

	test('a changed member dependency makes the projection stale, and reinstalling keeps the locked externals', BOUND, async () => {
		const project = scenario.workspace;
		await scenario.publish('later'); // React 19.2.0 now satisfies ^19
		scenario.layout.edit('workspace/packages/banner/package.json', manifest => (manifest.dependencies['@lt/message'] = 'workspace:packages/message'));
		const stale = await project.read();
		assert.equal(stale.state, 'stale', explain(stale.diagnostics));
		const changed = stale.diagnostics.find(({ code }) => code === 'EXECUTION_GRAPH_STALE')?.details?.changed;
		assert.deepEqual(changed, ['member:packages/banner'], explain(stale.diagnostics));
		assert.ok(stale.execution, 'a stale projection is still returned');
		assert.equal((await Execution.read(project.root)).state, 'ready', 'without current inputs only the lock is compared');

		const report = await project.install();
		assert.equal(report.valid, true, explain(report.diagnostics));
		assert.deepEqual([report.frozen, report.lock.written], [false, true]);
		const { graph } = project.lock();
		assert.equal(graph.edge(BANNER, '@lt/message').to, MESSAGE, 'the explicit member id is followed');
		assert.deepEqual(graph.versions('react'), ['18.3.1', '19.1.1'], 'the locked React is kept though 19.2.0 is published');
		assert.equal((await project.read()).state, 'ready');
	});

	test('an update selects the newest releases again and fetches only them', BOUND, async () => {
		const report = await scenario.workspace.install({ update: true });
		assert.equal(report.valid, true, explain(report.diagnostics));
		assert.deepEqual([report.frozen, report.counts.fetched], [false, 1]);
		assert.deepEqual(scenario.workspace.lock().graph.versions('react'), ['18.3.1', '19.2.0']);
		assert.equal((await scenario.workspace.read()).state, 'ready');
	});

	test('a changed or absent lock makes the projection stale; an absent or unreadable projection is reported', BOUND, async () => {
		const project = scenario.workspace;
		const { lock, projection } = project.files();
		const [path, file] = [project.path('beyond-lock.json'), project.path('.beyond', 'execution.json')];
		const stale = async () => {
			const read = await project.read();
			const changed = read.diagnostics.find(({ code }) => code === 'EXECUTION_GRAPH_STALE')?.details?.changed;
			assert.deepEqual([read.state, changed?.includes('lock')], ['stale', true], explain(read.diagnostics));
		};
		// Another lock, as a pull would bring it: one edge fewer, and the digest of that content
		const { digest, ...content } = JSON.parse(lock);
		content.edges = content.edges.slice(1);
		writeFileSync(path, Canonical.pretty({ ...content, digest: Canonical.digest(content) }));
		assert.notEqual(digest, Canonical.digest(content));
		await stale();
		rmSync(path);
		await stale();
		writeFileSync(path, lock);
		assert.equal((await project.read()).state, 'ready');

		rmSync(file);
		const missing = await project.read();
		assert.deepEqual([missing.state, codes(missing.diagnostics), missing.execution], ['missing', ['EXECUTION_GRAPH_MISSING'], undefined]);
		for (const text of ['{"protocol": "beyond-execution/0"}', 'not json']) {
			writeFileSync(file, text);
			const unreadable = await project.read();
			assert.deepEqual([unreadable.state, codes(unreadable.diagnostics)], ['incompatible', ['EXECUTION_GRAPH_INCOMPATIBLE']]);
		}
		writeFileSync(file, projection);
		assert.equal((await project.read()).state, 'ready');
	});

	for (const [damage, removed] of [['a stored source', location => dirname(location)], ['the files of a stored source', location => location]]) {
		test(`removing ${damage} makes the projection incomplete; reinstalling fetches only that source`, BOUND, async t => {
			const project = scenario.workspace;
			const key = project.lock().graph.key('scheduler', '0.23.2');
			const { location } = (await project.read()).execution.node(key);
			rmSync(removed(location), { recursive: true, force: true });
			// Should the installation not repair it, the whole stored source goes, so the next cases start sound
			t.after(() => existsSync(location) || rmSync(dirname(location), { recursive: true, force: true }));
			const incomplete = await project.read();
			assert.equal(incomplete.state, 'incomplete');
			assert.deepEqual(incomplete.diagnostics.map(({ code, node }) => [code, node]), [['SOURCE_MISSING', key]]);
			assert.ok(incomplete.execution, 'an incomplete projection is still returned');
			scenario.reset();
			const report = await project.install();
			assert.equal(report.valid, true, explain(report.diagnostics));
			assert.deepEqual([report.frozen, report.counts.fetched], [true, 1]);
			assert.deepEqual(scenario.recorder.requests().map(url => basename(url)), ['scheduler-0.23.2.tgz']);
			assert.equal((await project.read()).state, 'ready');
			assert.ok(existsSync(join(location, 'package.json')));
		});
	}

	test('offline, inputs the lock does not cover are OFFLINE_UNAVAILABLE, and nothing is written or requested', BOUND, async () => {
		const project = scenario.workspace;
		const files = project.files();
		scenario.layout.edit(MANIFEST, manifest => (manifest.dependencies.scheduler = '^0.26.0'));
		scenario.reset();
		const report = await project.install({ offline: true });
		scenario.layout.restore(MANIFEST);
		assert.equal(report.valid, false);
		assert.ok(codes(report.diagnostics).includes('OFFLINE_UNAVAILABLE'), explain(report.diagnostics));
		assert.deepEqual([report.lock.written, report.execution.written], [false, false]);
		assert.deepEqual(project.files(), files);
		assert.deepEqual([scenario.recorder.events, scenario.registry.log], [[], []]);
	});

	test('offline, a source missing from the store is OFFLINE_UNAVAILABLE naming its node, and recovers online', BOUND, async () => {
		const project = scenario.workspace;
		const key = project.lock().graph.key('use-store', '1.0.0');
		rmSync(dirname((await project.read()).execution.node(key).location), { recursive: true, force: true });
		const files = project.files();
		scenario.reset();
		const report = await project.install({ offline: true });
		assert.equal(report.valid, false);
		const named = report.diagnostics.filter(({ code }) => code === 'OFFLINE_UNAVAILABLE');
		assert.ok(named.some(({ node, message }) => node === key || message.includes('use-store')), explain(report.diagnostics));
		assert.deepEqual(project.files(), files);
		assert.deepEqual([scenario.recorder.events, scenario.registry.log], [[], []]);
		const online = await project.install();
		assert.equal(online.valid, true, explain(online.diagnostics));
		assert.equal((await project.read()).state, 'ready');
	});
});

describe('failures: invalid, bounded and nothing written (criterion 9)', () => {
	const scenario = new Scenario('failures');
	before(() => scenario.open());
	after(() => scenario.close());

	/** Installs with a short edit of the application's manifest, which is put back afterwards */
	const edited = async (change, options, settings) => {
		scenario.layout.edit(MANIFEST, change);
		try {
			return await scenario.workspace.install(options, settings);
		} finally {
			scenario.layout.restore(MANIFEST);
		}
	};
	const refused = (report, ...expected) => {
		assert.equal(report.valid, false, explain(report));
		for (const code of expected) assert.ok(codes(report.diagnostics).includes(code), `${code}: ${explain(report.diagnostics)}`);
		assert.deepEqual([report.lock.written, report.execution.written], [false, false]);
	};

	test('a package no registry has fails the resolution; without a previous installation nothing is created', BOUND, async () => {
		scenario.reset();
		const report = await edited(manifest => (manifest.dependencies['not-published'] = '^1.0.0'));
		refused(report, 'GRAPH_INCOMPLETE');
		assert.deepEqual(scenario.workspace.files(), { lock: null, projection: null });
		assert.equal(scenario.registry.requests.tarball, 0, 'no archive is fetched for an incomplete graph');
	});

	test('a failed resolution leaves the previous lock and projection intact, and the next one recovers', BOUND, async () => {
		const project = scenario.workspace;
		const baseline = await project.install();
		assert.equal(baseline.valid, true, explain(baseline.diagnostics));
		const files = project.files();
		refused(await edited(manifest => (manifest.dependencies['not-published'] = '^1.0.0')), 'GRAPH_INCOMPLETE');
		assert.deepEqual(project.files(), files);
		const recovered = await project.install();
		assert.deepEqual([recovered.valid, recovered.frozen], [true, true], explain(recovered.diagnostics));
		assert.equal((await project.read()).state, 'ready');
	});

	for (const [fault, release] of [['corrupt', 'react@19.1.1'], ['truncate', 'react-dom@19.1.1']]) {
		test(`a ${fault} archive is refused: invalid, nothing written or stored, and the next installation completes`, BOUND, async () => {
			const project = scenario.workspace;
			const [name, version] = release.split('@');
			const store = scenario.layout.path(`store-${fault}`);
			const files = project.files();
			scenario.registry.fault(name, version, fault);
			let report;
			try {
				report = await project.install({}, { store });
			} finally {
				scenario.registry.fault(name, version);
			}
			refused(report, 'SOURCES_INCOMPLETE');
			const key = project.lock().graph.key(name, version);
			assert.ok(report.diagnostics.some(({ node }) => node === key), `${key} named: ${explain(report.diagnostics)}`);
			assert.deepEqual(project.files(), files);
			assert.deepEqual(new Store(store).sources(name, version), []);
			const again = await project.install({}, { store });
			assert.equal(again.valid, true, explain(again.diagnostics));
			assert.deepEqual([again.counts.fetched, again.counts.reused], [1, RELEASES.length - 1]);
			assert.equal((await project.read()).state, 'ready');
		});
	}

	test('an unavailable registry fails the resolution at once: invalid, nothing written', BOUND, async () => {
		const project = scenario.workspace;
		const files = project.files();
		const registry = await Catalog.unreachable();
		const report = await project.install({ update: true }, { registry, metadata: scenario.layout.path('metadata-cold') });
		refused(report, 'GRAPH_INCOMPLETE');
		assert.deepEqual(project.files(), files);
	});

	test('a local range no member satisfies is WORKSPACE_RANGE_UNSATISFIED, though the registry has one', BOUND, async () => {
		const files = scenario.workspace.files();
		scenario.reset();
		const report = await edited(manifest => (manifest.dependencies['@lt/message'] = '^3.0.0'));
		refused(report, 'GRAPH_INCOMPLETE', 'WORKSPACE_RANGE_UNSATISFIED');
		const { message } = report.diagnostics.find(({ code }) => code === 'WORKSPACE_RANGE_UNSATISFIED');
		assert.ok(['1.0.0', '2.0.0'].every(version => message.includes(version)), message);
		assert.deepEqual(scenario.registry.log.filter(({ path }) => local(path)), []);
		assert.deepEqual(scenario.workspace.files(), files);
	});

	test('a workspace: specification of a name no member provides is WORKSPACE_PACKAGE_NOT_FOUND', BOUND, async () => {
		const files = scenario.workspace.files();
		scenario.reset();
		const report = await edited(manifest => (manifest.dependencies['@lt/absent'] = 'workspace:^1.0.0'));
		refused(report, 'GRAPH_INCOMPLETE', 'WORKSPACE_PACKAGE_NOT_FOUND');
		assert.deepEqual(scenario.registry.log.filter(({ path }) => local(path)), []);
		assert.deepEqual(scenario.workspace.files(), files);
	});

	test('concurrent installations through one instance are serialized: one resolves and writes, the other is frozen', BOUND, async () => {
		const project = scenario.project('second', { store: scenario.layout.path('store-concurrent') });
		const installation = project.installation();
		const reports = await Promise.all([installation.install(), installation.install()]);
		for (const report of reports) assert.equal(report.valid, true, explain(report.diagnostics));
		const outcomes = reports.map(({ frozen, lock, counts }) => [frozen, lock.written, counts.fetched, counts.reused]);
		assert.deepEqual(outcomes.sort(), [[false, true, 2, 0], [true, false, 0, 2]]);
		assert.equal((await project.read()).state, 'ready');
	});

	test('a stage a killed download left behind is removed by the next fetch, and one still in use is kept', BOUND, async () => {
		const store = scenario.layout.path('store-abandoned');
		const stage = name => join(store, '.staging', name);
		for (const name of ['source-abandoned', 'source-live']) {
			mkdirSync(join(stage(name), 'files'), { recursive: true });
			writeFileSync(join(stage(name), 'files', 'index.js'), 'partial');
		}
		// Untouched for an hour, far beyond the download timeout
		const old = new Date(Date.now() - 3_600_000);
		for (const path of [join(stage('source-abandoned'), 'files', 'index.js'), join(stage('source-abandoned'), 'files'), stage('source-abandoned')]) {
			utimesSync(path, old, old);
		}
		const report = await scenario.workspace.install({}, { store });
		assert.equal(report.valid, true, explain(report.diagnostics));
		assert.deepEqual([existsSync(stage('source-abandoned')), existsSync(stage('source-live'))], [false, true]);
		assert.equal(new Store(store).sources().length, RELEASES.length, 'a stage is never published');
	});
});
