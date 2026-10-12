/**
 * Integration: plans of explicit dependency changes and their application (`beyond-dependencies/1`) on the real host
 * of the development service, over a copy of `fixtures/workspace` installed first and two in-process registries
 * (`fixtures/README.md`): a targeted update that keeps every unrelated node, React 18 to 19 in one application (a peer
 * requirement that blocks it, then the coherent change with a person's edit kept), a duplicated singleton, missing
 * versions and refused sources, idempotent and reconciled applications, and stale plans. Run from the Packages directory
 * under BEE Node with BEE_URL and WATCHERS_URL: `node --import "$BEE_NODE_DIR/register.mjs" --test tests/dependencies/plans.test.mjs`.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Scenario } from './support/served.mjs';

const RELEASES = ['react@18.3.1', 'react@19.1.1', 'react-dom@18.3.1', 'react-dom@19.1.1', 'scheduler@0.23.2', 'scheduler@0.26.0', 'loose-envify@1.4.0', 'js-tokens@4.0.0', 'shared-lib@1.0.0', 'shared-lib@2.0.0', 'chart-kit@1.0.0', 'old-widget@1.0.0', '@team/tokens@1.0.0', '@team/secret-sdk@1.0.0'];
const scenario = new Scenario('workspace');

before(async () => {
	await scenario.start({ releases: RELEASES });
	const installed = await scenario.request('POST', '/installation', { body: {} });
	if (!installed.body.valid) throw new Error(`The fixture did not install: ${JSON.stringify(installed.body)}`);
	// Newer releases published after the installation: a targeted plan must not take them
	await scenario.publish('shared-lib@1.1.0');
	await scenario.publish('chart-kit@1.2.0');
});
after(async () => {
	process.env.BEYOND_HOST_LOG === '1' && console.log(scenario.log);
	await scenario.stop();
});

const base = async () => (await scenario.request('GET', '/dependencies')).body.base;
const plan = async (changes, given) => {
	const { operation } = await scenario.run('/dependencies/plans', { changes, base: given ?? (await base()) });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	return operation.result;
};
const apply = (plan, key) => scenario.run(`/dependencies/plans/${plan.id}/apply`, { base: plan.base }, { 'idempotency-key': key });
const versions = (lock, name) => Object.values(lock.nodes).filter(node => node.name === name).map(({ version }) => version).sort();
const codes = plan => plan.diagnostics.map(({ code }) => code);

test('a targeted plan moves one package, keeps every unrelated node, and applying it installs exactly that', { timeout: 300000 }, async () => {
	const proposed = await plan([{ name: 'shared-lib', version: '1.1.0' }]);
	assert.equal(proposed.valid, true, JSON.stringify(proposed.diagnostics));
	assert.match(proposed.id, /^pln_[0-9a-f]{24}$/);
	assert.deepEqual(proposed.edits, []);
	assert.equal(proposed.changed.length, 1);
	const [changed] = proposed.changed;
	assert.deepEqual([changed.name, changed.from.version, changed.to.version, changed.reason], ['shared-lib', '1.0.0', '1.1.0', 'requested']);
	assert.equal(changed.dependents.length, 2, 'both dependents move to the one release');
	assert.deepEqual([proposed.added, proposed.removed], [[], []]);
	assert.equal(proposed.preserved.count, 7);
	assert.deepEqual(proposed.affected.members.map(({ id }) => id), ['apps/admin', 'apps/web']);
	assert.deepEqual(proposed.affected.modules.list.map(({ specifier }) => specifier), ['@fixture/web/main']);
	assert.equal(proposed.work.resolution.attempts, 1);
	assert.ok(proposed.work.resolution.requests > 0);
	const stored = await scenario.request('GET', `/dependencies/plans/${proposed.id}`);
	assert.deepEqual(stored.body.plan, proposed);

	const before = scenario.lock;
	const { started, operation } = await apply(proposed, 'apply-shared-lib-0001');
	assert.equal(started.status, 202);
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	assert.deepEqual(operation.steps.map(({ id, state }) => [id, state]), [['verify', 'done'], ['write', 'skipped'], ['resolve', 'done'], ['fetch', 'done'], ['materialize', 'done'], ['reload', 'done']]);
	assert.equal(operation.result.lock.digest, proposed.proposed.lock, 'what was installed is what was planned');
	assert.deepEqual(operation.result.counts, { members: 3, nodes: 11, fetched: 1, reused: 7 });

	const after = scenario.lock;
	for (const [key, node] of Object.entries(before.nodes)) node.name !== 'shared-lib' && assert.deepEqual(after.nodes[key], node, `${key} is kept, integrity included`);
	assert.deepEqual(versions(after, 'shared-lib'), ['1.1.0']);
	assert.deepEqual(versions(after, 'chart-kit'), ['1.0.0'], 'a newer release of an unrelated package is not taken');
	const described = (await scenario.request('GET', '/dependencies')).body;
	assert.equal(described.installation.state, 'ready');
	assert.equal(described.nodes.find(({ name }) => name === 'shared-lib').status, 'installed');

	const repeated = await scenario.request('POST', `/dependencies/plans/${proposed.id}/apply`, { body: { base: proposed.base }, headers: { 'idempotency-key': 'apply-shared-lib-0001' } });
	assert.equal(repeated.status, 200);
	assert.equal(repeated.body.operation.id, operation.id, 'the same request is the same application');
	const lost = await apply(proposed, 'apply-shared-lib-0002');
	assert.equal(lost.operation.state, 'succeeded');
	assert.equal(lost.operation.result.reconciled, true, 'an application already in place is recognized, not repeated');
	assert.deepEqual(lost.operation.steps.slice(1, 5).map(({ state }) => state), ['skipped', 'skipped', 'skipped', 'skipped']);
});

test('React 19 for one application alone: the peer requirement of react-dom blocks it, and it is not applied', { timeout: 300000 }, async () => {
	const proposed = await plan([{ name: 'react', importer: 'apps/web', range: '^19.1.0' }]);
	assert.equal(proposed.valid, false);
	const peer = proposed.diagnostics.find(({ code }) => code === 'PEER_INCOMPATIBLE');
	assert.equal(peer.kind, 'peer');
	assert.match(peer.message, /react-dom@18\.3\.1/);
	assert.equal(proposed.work.resolution.attempts, 2, 'the peers of react were released once, which did not help');
	assert.deepEqual(proposed.edits.map(({ path, name, before, after }) => [path, name, before, after]), [['apps/web/package.json', 'react', '^18.3.1', '^19.1.0']]);

	const refused = await scenario.request('POST', `/dependencies/plans/${proposed.id}/apply`, { body: { base: proposed.base }, headers: { 'idempotency-key': 'apply-react-alone' } });
	assert.equal(refused.status, 422);
	assert.equal(refused.body.error.code, 'PLAN_INVALID');
	assert.match(scenario.read('apps/web/package.json'), /"react": "\^18\.3\.1"/, 'nothing was written');
});

test('React 19 with react-dom: requested and transitive changes, both releases in their contexts, and a person\'s edit kept', { timeout: 300000 }, async () => {
	const proposed = await plan([{ name: 'react', importer: 'apps/web', range: '^19.1.0' }, { name: 'react-dom', importer: 'apps/web', range: '^19.1.0' }]);
	assert.equal(proposed.valid, true, JSON.stringify(proposed.diagnostics));
	const summary = list => list.map(({ name, from, to, version, reason }) => [name, from?.version ?? version, to?.version, reason]);
	assert.deepEqual(summary(proposed.changed), [['react', '18.3.1', '19.1.1', 'requested'], ['react-dom', '18.3.1', '19.1.1', 'requested']]);
	assert.deepEqual(summary(proposed.added), [['scheduler', '0.26.0', undefined, 'transitive']]);
	assert.deepEqual(summary(proposed.removed), [['scheduler', '0.23.2', undefined, 'transitive']]);
	const react = proposed.contexts.find(({ name }) => name === 'react');
	assert.deepEqual(react.nodes.map(({ version, importers }) => [version, importers]), [['18.3.1', ['apps/admin']], ['19.1.1', ['apps/web']]]);
	assert.ok(!codes(proposed).includes('SINGLETON_DUPLICATED'));

	// A person edits the manifest after the plan: another field, written through the File API
	const path = '/files/content/apps/web/package.json';
	const read = await fetch(`${scenario.origin}${path}`);
	const text = (await read.text()).replace('"version": "1.0.0",', '"version": "1.0.0",\n\t"description": "Edited by a person",');
	const written = await scenario.request('PUT', path, { raw: text, headers: { 'content-type': 'application/octet-stream', 'if-match': read.headers.get('etag') } });
	assert.equal(written.body.outcome, 'completed');

	const { operation } = await apply(proposed, 'apply-react-19-0001');
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	assert.deepEqual(operation.steps[1].counts, { done: 1, total: 1, unit: 'files' });
	const manifest = scenario.read('apps/web/package.json');
	assert.match(manifest, /\n\t"description": "Edited by a person",\n/, 'the edit and its tabs are kept');
	assert.match(manifest, /\n\t\t"react": "\^19\.1\.0",\n\t\t"react-dom": "\^19\.1\.0",\n/);
	const lock = scenario.lock;
	assert.deepEqual([versions(lock, 'react'), versions(lock, 'react-dom'), versions(lock, 'scheduler')], [['18.3.1', '19.1.1'], ['19.1.1'], ['0.26.0']]);
	const web = (await scenario.request('GET', '/dependencies?scope=member:apps/web')).body;
	assert.equal(web.installation.state, 'ready');
	assert.equal(web.nodes.find(({ name, version }) => name === 'react' && version === '19.1.1').status, 'installed');
});

test('a plan says when a page would load two releases of React', { timeout: 300000 }, async () => {
	const proposed = await plan([{ name: 'old-widget', importer: 'apps/web', range: '^1.0.0' }]);
	assert.equal(proposed.valid, true, 'a duplicated singleton is a warning: the person decides');
	const duplicated = proposed.diagnostics.find(({ code }) => code === 'SINGLETON_DUPLICATED');
	assert.deepEqual([duplicated.importer, duplicated.name, duplicated.versions, duplicated.introduced, duplicated.severity], ['apps/web', 'react', ['18.3.1', '19.1.1'], true, 'warning']);
	assert.deepEqual(proposed.added.map(({ name, reason }) => [name, reason]), [['old-widget', 'requested']]);
	assert.deepEqual(proposed.edits.map(({ group, name, before, after }) => [group, name, before, after]), [['dependencies', 'old-widget', null, '^1.0.0']]);
});

test('a missing version, one no range admits, an unresolved range and a refused source make a plan invalid', { timeout: 300000 }, async () => {
	const missing = await plan([{ name: 'shared-lib', version: '1.5.0' }]);
	assert.deepEqual([missing.valid, codes(missing).includes('VERSION_NOT_FOUND')], [false, true]);
	const excluded = await plan([{ name: 'shared-lib', version: '2.0.0' }]);
	assert.deepEqual([excluded.valid, codes(excluded).includes('VERSION_NOT_ADMITTED')], [false, true]);
	const unresolved = await plan([{ name: 'react', importer: 'apps/admin', range: '^20.0.0' }]);
	assert.equal(unresolved.diagnostics.find(({ code }) => code === 'VERSION_UNRESOLVED').kind, 'version');
	const denied = await plan([{ name: '@team/secret-sdk', importer: 'apps/web', range: '^1.0.0' }]);
	const refused = denied.diagnostics.find(({ code, severity }) => code === 'PROVIDER_AUTH_DENIED' && severity === 'error');
	assert.equal(refused.kind, 'source', 'missing access is said, never answered with another source');

	const post = body => scenario.request('POST', '/dependencies/plans', { body });
	assert.equal((await post({ changes: [], base: await base() })).body.error.code, 'CHANGES_INVALID');
	assert.equal((await post({ changes: [{ name: 'shared-lib' }] })).body.error.code, 'BASE_REQUIRED');
	const undeclared = await post({ changes: [{ name: 'left-pad' }], base: await base() });
	assert.deepEqual([undeclared.status, undeclared.body.error.code], [422, 'CHANGE_UNDECLARED']);
	const text = await scenario.request('POST', '/dependencies/plans', { raw: '{}', headers: { 'content-type': 'text/plain' } });
	assert.equal(text.status, 415);
	const unknown = await scenario.request('GET', '/dependencies/plans/pln_000000000000000000000000');
	assert.deepEqual([unknown.status, unknown.body.error.code], [404, 'PLAN_NOT_FOUND']);
	const keyless = await scenario.request('POST', `/dependencies/plans/${missing.id}/apply`, { body: { base: missing.base } });
	assert.deepEqual([keyless.status, keyless.body.error.code], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
});

test('a plan made against another state is stale: it is refused, and applying it writes nothing', { timeout: 300000 }, async () => {
	const proposed = await plan([{ name: 'chart-kit' }]);
	assert.deepEqual(proposed.changed.map(({ name, to }) => [name, to.version]), [['chart-kit', '1.2.0']]);

	// The admin's declarations change after the plan was made
	const path = '/files/content/apps/admin/package.json';
	const read = await fetch(`${scenario.origin}${path}`);
	const text = (await read.text()).replace('"react": "^18.3.1"', '"old-widget": "^1.0.0",\n    "react": "^18.3.1"');
	const written = await scenario.request('PUT', path, { raw: text, headers: { 'content-type': 'application/octet-stream', 'if-match': read.headers.get('etag') } });
	assert.equal(written.body.outcome, 'completed');

	const lock = scenario.read('beyond-lock.json');
	const { operation } = await apply(proposed, 'apply-stale-0001');
	assert.equal(operation.state, 'failed');
	assert.equal(operation.error.code, 'PLAN_STALE');
	assert.equal(scenario.read('beyond-lock.json'), lock, 'nothing was installed');
	assert.equal((await scenario.request('GET', `/dependencies/plans/${proposed.id}`)).body.plan.application.state, 'failed');

	const again = await scenario.request('POST', '/dependencies/plans', { body: { changes: [{ name: 'chart-kit' }], base: proposed.base } });
	assert.deepEqual([again.status, again.body.error.code], [409, 'PLAN_STALE']);
});
