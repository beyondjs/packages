/**
 * Plans of dependency changes and their application (`service/host/dependencies`) through the routes, over a copy of
 * the fixtures of `tests/dependencies` with its hand-written lock (`fixtures/locks/workspace.json`) and the stand-ins of
 * its `support/stage.mjs`, whose `Installation` answers the resolutions each case scripts. The real resolver and host
 * are validated by `tests/dependencies/plans.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Stage } from '../../tests/dependencies/support/stage.mjs';
import { Operations } from '../host/operations/operations.mjs';
import { Services } from '../host/features.mjs';
import { Modules } from '../host/dependencies/modules.mjs';
import { Feature } from '../host/dependencies/index.mjs';
import { Impact } from '../host/dependencies/impact.mjs';

const LOCK = JSON.parse(readFileSync(new URL('../../tests/dependencies/fixtures/locks/workspace.json', import.meta.url), 'utf8'));
const graph = () => structuredClone({ members: LOCK.members, nodes: LOCK.nodes, edges: LOCK.edges, overrides: [], exceptions: [] });
const release = (name, version) => ({ name, version, origin: { provider: 'npm', registry: 'https://registry.npmjs.org/' }, visibility: 'public', integrity: `sha512-${name}@${version}`, tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` });

/**
 * Points the edges that reach a node (all of them, or those a filter keeps) at another release, and drops the node
 * nothing reaches any more
 */
const move = (document, from, to, keep = () => true) => {
	const [name, version] = [to.slice(4, to.lastIndexOf('@')), to.slice(to.lastIndexOf('@') + 1)];
	document.nodes[to] ??= release(name, version);
	document.edges.filter(edge => edge.to === from && keep(edge)).forEach(edge => (edge.to = to));
	document.edges.some(edge => edge.to === from) || delete document.nodes[from];
	return document;
};
const resolution = (document, fields = {}) => ({ valid: true, graph: document, lock: 'sha256-proposed', diagnostics: [], requests: 3, duration: 12, releases: [], ...fields });
const report = { protocol: 'beyond-installation/1', valid: true, frozen: false, lock: { path: 'beyond-lock.json', digest: 'sha256-proposed', written: true }, execution: { path: '.beyond/execution.json', written: true }, counts: { members: 3, nodes: 11, fetched: 1, reused: 7 }, diagnostics: [] };

const planned = async (stage, changes) => {
	const { base } = (await stage.send('GET', '/dependencies')).body;
	const operation = await stage.run('/dependencies/plans', { changes, base });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	return operation.result;
};
const applied = (stage, plan, key) => stage.run(`/dependencies/plans/${plan.id}/apply`, { base: plan.base }, { 'idempotency-key': key });

test('a targeted plan compares the proposed graph with the lock: changes with their dependents, additions and what is kept', async t => {
	const published = [{ specifier: '@fixture/web/main', vspecifier: '@fixture/web@1.0.0/main', name: '@fixture/web', version: '1.0.0' }, { specifier: '@fixture/view/x', name: '@fixture/view', version: '1.0.0' }];
	const stage = await Stage.start(t, { lock: true, state: 'ready', published });
	const proposed = move(graph(), 'npm:shared-lib@1.0.0', 'npm:shared-lib@1.1.0');
	proposed.nodes['npm:tiny@1.0.0'] = release('tiny', '1.0.0');
	proposed.edges.push({ from: 'npm:shared-lib@1.1.0', to: 'npm:tiny@1.0.0', kind: 'dependency', range: '^1.0.0' });
	stage.installation.resolutions = [resolution(proposed)];

	const plan = await planned(stage, [{ name: 'shared-lib', version: '1.1.0' }]);
	assert.equal(plan.valid, true);
	assert.deepEqual(plan.changed, [{ name: 'shared-lib', from: { key: 'npm:shared-lib@1.0.0', version: '1.0.0' }, to: { key: 'npm:shared-lib@1.1.0', version: '1.1.0' }, dependents: ['npm:chart-kit@1.0.0', 'workspace:apps/web'], reason: 'requested' }]);
	assert.deepEqual(plan.added, [{ key: 'npm:tiny@1.0.0', name: 'tiny', version: '1.0.0', reason: 'transitive' }]);
	assert.deepEqual([plan.removed, plan.preserved], [[], { count: 7 }]);
	assert.deepEqual(plan.affected.members.map(({ id }) => id), ['apps/admin', 'apps/web']);
	assert.deepEqual(plan.affected.modules.list.map(({ specifier }) => specifier), ['@fixture/web/main']);
	assert.deepEqual(plan.affected.targets, { available: false, list: [] }, 'no catalog of applications is shared');
	assert.deepEqual(plan.proposed.lock, 'sha256-proposed');

	const [call] = stage.installation.calls;
	assert.equal(call.method, 'resolve');
	assert.ok(!('update' in call.options), 'a plan never resolves as an update');
	assert.deepEqual(call.options.names, ['shared-lib']);
	const pins = call.options.preferences.map(({ name, version }) => `${name}@${version}`);
	assert.ok(pins.includes('shared-lib@1.1.0') && pins.includes('shared-lib@1.0.0') && pins.includes('chart-kit@1.0.0'), pins.join());
	assert.deepEqual((await stage.send('GET', `/dependencies/plans/${plan.id}`)).body.plan, plan);
});

test('a plan releases the package whose peer requirement blocks a requested change, and keeps the better resolution', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	const web = edge => edge.from === 'workspace:apps/web' || edge.context === 'workspace:apps/web';
	const first = move(graph(), 'npm:react@18.3.1', 'npm:react@19.1.1', web);
	const peer = { code: 'PEER_INCOMPATIBLE', message: '"react-dom@18.3.1" requires the peer "react@^18.3.1"', severity: 'error', node: 'npm:react-dom@18.3.1' };
	const second = move(structuredClone(first), 'npm:react-dom@18.3.1', 'npm:react-dom@19.1.1');
	stage.installation.resolutions = [resolution(first, { valid: false, diagnostics: [peer] }), resolution(second)];

	const plan = await planned(stage, [{ name: 'react', importer: 'apps/web', range: '^19.1.0' }]);
	assert.equal(plan.valid, true);
	assert.deepEqual([plan.work.resolution.attempts, plan.work.released], [2, ['react-dom']]);
	assert.deepEqual(plan.changed.map(({ name, reason }) => [name, reason]), [['react', 'requested'], ['react-dom', 'peer']]);
	assert.deepEqual(plan.edits, [{ member: 'apps/web', path: 'apps/web/package.json', group: 'dependencies', name: 'react', before: '^18.3.1', after: '^19.1.0' }]);
	const [one, two] = stage.installation.calls.filter(({ method }) => method === 'resolve');
	assert.ok(one.options.preferences.some(({ name }) => name === 'react-dom'));
	assert.ok(!two.options.preferences.some(({ name }) => name === 'react-dom'), 'the second resolution releases react-dom');
	assert.ok(two.options.preferences.some(({ name }) => name === 'chart-kit'), 'and nothing else');
	assert.equal(one.params.members.find(({ id }) => id === 'apps/web').manifest.dependencies.react, '^19.1.0', 'the edit is resolved in memory');
	assert.match(stage.read('apps/web/package.json'), /"react": "\^18\.3\.1"/, 'and not written');
});

test('the findings of a plan: a version not published or not selected, a duplicated singleton and a changed integrity', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	const changed = graph();
	changed.nodes['npm:js-tokens@4.0.0'].integrity = 'sha512-other';
	changed.nodes['npm:old-widget@1.0.0'] = release('old-widget', '1.0.0');
	changed.nodes['npm:react@17.0.2'] = release('react', '17.0.2');
	changed.edges.push({ from: 'workspace:apps/web', to: 'npm:old-widget@1.0.0', kind: 'dependency', range: '^1.0.0' }, { from: 'npm:old-widget@1.0.0', to: 'npm:react@17.0.2', kind: 'dependency', range: '^17.0.0' });
	const published = { name: 'shared-lib', found: true, versions: ['1.1.0', '1.0.0'], tags: {}, deprecated: {}, access: 'public' };
	stage.installation.resolutions = [resolution(changed, { releases: [published] })];

	const missing = await planned(stage, [{ name: 'shared-lib', version: '1.5.0' }]);
	const find = (plan, code) => plan.diagnostics.find(one => one.code === code);
	assert.equal(missing.valid, false);
	assert.equal(find(missing, 'VERSION_NOT_FOUND').kind, 'version');
	assert.deepEqual([find(missing, 'INTEGRITY_MISMATCH').node, find(missing, 'INTEGRITY_MISMATCH').kind], ['npm:js-tokens@4.0.0', 'integrity']);
	const singleton = find(missing, 'SINGLETON_DUPLICATED');
	assert.deepEqual([singleton.importer, singleton.name, singleton.versions, singleton.introduced, singleton.severity], ['apps/web', 'react', ['17.0.2', '18.3.1'], true, 'warning']);
	assert.deepEqual(missing.contexts.find(({ name }) => name === 'react').nodes.map(({ version }) => version).sort(), ['17.0.2', '18.3.1']);

	const excluded = await planned(stage, [{ name: 'shared-lib', version: '1.1.0' }]);
	assert.ok(find(excluded, 'VERSION_NOT_ADMITTED'), 'published, and not what the graph selected');
});

test('applying writes the manifests through the File API, installs with the plan\'s preferences and reloads', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.resolutions = [resolution(graph())];
	stage.installation.report = report;
	const plan = await planned(stage, [{ name: 'react', importer: 'apps/admin', range: '^18.3.1 || ^19.0.0' }]);
	assert.equal(plan.edits[0].path, 'apps/admin/package.json');

	const operation = await applied(stage, plan, 'apply-0001');
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	assert.deepEqual(operation.steps.map(({ id, state }) => [id, state]), [['verify', 'done'], ['write', 'done'], ['resolve', 'done'], ['fetch', 'done'], ['materialize', 'done'], ['reload', 'done']]);
	assert.deepEqual(operation.steps[1].counts, { done: 1, total: 1, unit: 'files' });
	const manifest = stage.read('apps/admin/package.json');
	assert.match(manifest, /\n {4}"react": "\^18\.3\.1 \|\| \^19\.0\.0"\n/, 'two spaces of indentation kept');
	assert.match(manifest, /"description": "Indented with two spaces/);
	assert.deepEqual(stage.files.writes.map(({ path, actor }) => [path, actor]), [['apps/admin/package.json', { sub: 'dependencies', kind: 'service', task: plan.id }]]);

	const install = stage.installation.calls.find(({ method }) => method === 'install');
	assert.deepEqual(install.options.preferences, plan.preferences);
	assert.ok(!('update' in install.options));
	assert.equal(install.params.members.find(({ id }) => id === 'apps/admin').manifest.dependencies.react, '^18.3.1 || ^19.0.0', 'the written manifests are read again');
	assert.equal(stage.reloads, 1);
	assert.equal(operation.result.reconciled, false);
	assert.equal((await stage.send('GET', `/dependencies/plans/${plan.id}`)).body.plan.application.state, 'applied');
});

test('a manifest changed between its read and its write is a conflict, and nothing is installed', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready', before: async path => stage.write(path, `${stage.read(path)}\n`) });
	stage.installation.resolutions = [resolution(graph())];
	const plan = await planned(stage, [{ name: 'react', importer: 'apps/admin', range: '^18.3.1 || ^19.0.0' }]);
	const operation = await applied(stage, plan, 'apply-conflict');
	assert.deepEqual([operation.state, operation.error.code], ['failed', 'MANIFEST_CONFLICT']);
	assert.ok(!stage.installation.calls.some(({ method }) => method === 'install'));
	assert.match(stage.read('apps/admin/package.json'), /"react": "\^18\.3\.1"\n/);
	assert.equal((await stage.send('GET', `/dependencies/plans/${plan.id}`)).body.plan.application.state, 'failed');
});

test('applying needs a request identifier, answers a repeated one with its operation, and refuses invalid or stale plans', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.resolutions = [resolution(graph(), { valid: false, diagnostics: [{ code: 'VERSION_UNRESOLVED', message: 'none', severity: 'error' }] }), resolution(graph())];
	stage.installation.report = report;
	const invalid = await planned(stage, [{ name: 'react' }]);
	const plan = await planned(stage, [{ name: 'react' }]);
	const send = (id, body, key) => stage.send('POST', `/dependencies/plans/${id}/apply`, { body, headers: key ? { 'idempotency-key': key } : {} });

	assert.deepEqual((await send(invalid.id, { base: invalid.base }, 'apply-invalid')).body.error.code, 'PLAN_INVALID');
	const keyless = await send(plan.id, { base: plan.base });
	assert.deepEqual([keyless.status, keyless.body.error.code], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
	for (const key of ['with spaces', 'short', 'tilde~0000000', 'x'.repeat(129)]) {
		const malformed = await send(plan.id, { base: plan.base }, key);
		assert.deepEqual([malformed.status, malformed.body.error.code], [400, 'IDEMPOTENCY_KEY_INVALID'], key);
	}
	assert.deepEqual((await send(plan.id, { base: { ...plan.base, inputs: 'sha256-other' } }, 'apply-other')).status, 409);
	assert.deepEqual((await send('pln_000000000000000000000000', { base: plan.base }, 'apply-none')).status, 404);

	// The lock changes on disk after the plan: the operation finds it before writing anything
	stage.write('beyond-lock.json', `${JSON.stringify(JSON.parse(stage.read('beyond-lock.json')), null, 4)}\n`);
	const first = await send(plan.id, { base: plan.base }, 'apply-0002');
	assert.equal(first.status, 202);
	const ended = await stage.ended(first.body.operation.id);
	assert.deepEqual([ended.state, ended.error.code], ['failed', 'PLAN_STALE']);
	const again = await send(plan.id, { base: plan.base }, 'apply-0002');
	assert.deepEqual([again.status, again.body.operation.id], [200, first.body.operation.id]);
	assert.ok(!stage.installation.calls.some(({ method }) => method === 'install'));
});

test('an application the service stopped is reconciled with what the workspace holds when it starts again', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.resolutions = [resolution(graph()), resolution(graph(), { lock: LOCK.digest })];
	const pending = await planned(stage, [{ name: 'react' }]);
	const done = await planned(stage, [{ name: 'chart-kit' }]);

	let open;
	const never = new Promise(resolve => (open = resolve));
	t.after(() => open());
	for (const plan of [pending, done]) {
		await stage.operations.run({ kind: 'dependencies.apply', key: `apply-${plan.id}`, scope: { kind: 'workspace', plan: plan.id }, steps: [{ id: 'verify' }] }, () => never);
	}
	await stage.operations.settled();

	const operations = new Operations({ root: stage.root });
	await operations.start();
	const Execution = { read: async () => ({ state: 'ready', diagnostics: [], execution: { node: () => ({}) } }) };
	const context = { root: stage.root, settings: {}, workspace: {}, operations, services: new Services(), log: () => void 0 };
	await new Feature(context, new Modules({ Installation: stage.installation.class, Execution })).start();

	const application = async plan => (await stage.send('GET', `/dependencies/plans/${plan.id}`)).body.plan.application;
	assert.deepEqual([(await application(pending)).state, (await application(pending)).outcome], ['interrupted', 'not-applied']);
	assert.deepEqual([(await application(done)).state, (await application(done)).outcome], ['interrupted', 'applied']);
	open();
	await operations.idle();
});

test('what a plan affects is read within a bound: a served workspace that does not answer is said, not waited for', async t => {
	const bound = Impact.BOUND;
	Impact.BOUND = 50;
	t.after(() => (Impact.BOUND = bound));
	const applications = { catalog: async () => ({ applications: [{ id: 'shop', targets: [{ id: 'web', package: '@fixture/web' }, { id: 'api', package: '@fixture/api' }] }] }) };
	const stage = await Stage.start(t, { lock: true, state: 'ready', published: () => new Promise(() => void 0), applications });
	stage.installation.resolutions = [resolution(move(graph(), 'npm:shared-lib@1.0.0', 'npm:shared-lib@1.1.0'))];
	const plan = await planned(stage, [{ name: 'shared-lib', version: '1.1.0' }]);
	assert.deepEqual([plan.affected.modules.available, plan.affected.modules.count], [false, 0]);
	assert.match(plan.affected.modules.reason, /did not answer within 50 ms/);
	assert.deepEqual(plan.affected.targets, { available: true, list: [{ application: 'shop', target: 'web', package: '@fixture/web' }] });
});

test('a resolution that answers no graph changes nothing the plan could show, and the plan cannot be applied', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.resolutions = [{ valid: false, diagnostics: [{ code: 'RESOLUTION_TIMEOUT', message: 'The resolution did not finish within 540 s', severity: 'error' }], requests: 40, duration: 540000, releases: [] }];
	const plan = await planned(stage, [{ name: 'shared-lib', version: '1.1.0' }]);
	assert.deepEqual([plan.valid, plan.changed, plan.added, plan.removed, plan.preserved], [false, [], [], [], { count: 0 }]);
	assert.deepEqual(plan.diagnostics.map(({ code, kind }) => [code, kind]), [['RESOLUTION_TIMEOUT', 'resolution']]);
	assert.equal(plan.proposed.lock, null);
});
