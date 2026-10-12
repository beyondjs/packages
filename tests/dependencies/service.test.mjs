/**
 * Integration: dependency management (`beyond-dependencies/1`) on the real host of the development service, over a
 * copy of `fixtures/workspace` and two in-process registries (`fixtures/README.md`): the capability, the inventory and
 * its scopes before and after an installation, the preflight, and checks, read-only and cancellable. Run from the
 * Packages directory under BEE Node with the implementation and the watchers utility served (BEE_URL, WATCHERS_URL):
 * `node --import "$BEE_NODE_DIR/register.mjs" --test tests/dependencies/service.test.mjs`.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Scenario } from './support/served.mjs';

const RELEASES = ['react@18.3.1', 'react@19.1.1', 'react-dom@18.3.1', 'react-dom@19.1.1', 'scheduler@0.23.2', 'scheduler@0.26.0', 'loose-envify@1.4.0', 'js-tokens@4.0.0', 'shared-lib@1.0.0', 'shared-lib@2.0.0', 'chart-kit@1.0.0', '@team/tokens@1.0.0', '@team/secret-sdk@1.0.0'];
const scenario = new Scenario('workspace');

before(async () => {
	await scenario.start({ releases: RELEASES });
});
after(async () => {
	process.env.BEYOND_HOST_LOG === '1' && console.log(scenario.log);
	await scenario.stop();
});

const inventory = async (scope = 'workspace') => {
	const { status, body } = await scenario.request('GET', `/dependencies?scope=${encodeURIComponent(scope)}`);
	assert.equal(status, 200, JSON.stringify(body));
	return body;
};
const node = (document, name, version) => document.nodes.find(one => one.name === name && (version === undefined || one.version === version));

test('the feature claims its capability and describes what is declared before anything is installed', { timeout: 300000 }, async () => {
	const session = await scenario.request('GET', '/session');
	assert.equal(session.body.capabilities.dependencies, 1);

	scenario.registries.public.clear();
	const described = await inventory();
	assert.equal(described.protocol, 'beyond-dependencies/1');
	assert.equal(described.installation.state, 'missing');
	assert.deepEqual(described.lock, { present: false, digest: null });
	assert.equal(described.base.lock, 'absent');
	assert.equal(described.base.inputs, described.inputs.digest);
	assert.deepEqual(described.members.map(({ id }) => id), ['apps/admin', 'apps/web', 'packages/view']);

	const react = node(described, 'react');
	assert.equal(react.key, 'declared:react');
	assert.equal(react.status, 'declared');
	assert.equal(react.version, null);
	assert.deepEqual(react.declared, [
		{ importer: 'apps/admin', range: '^18.3.1', type: 'prod' },
		{ importer: 'apps/web', range: '^18.3.1', type: 'prod' },
		{ importer: 'packages/view', range: '^18.3.1', type: 'dev' },
		{ importer: 'packages/view', range: '^18.3.1 || ^19.0.0', type: 'peer' }
	]);
	const view = node(described, '@fixture/view');
	assert.deepEqual(view.source, { kind: 'member', member: 'packages/view' });
	assert.deepEqual(view.declared, [{ importer: 'apps/web', range: '^1.0.0', type: 'prod' }], 'a name a member provides leads to the member');
	assert.deepEqual(scenario.registries.public.requests, [], 'the inventory is local: no registry is asked');

	const invalid = await scenario.request('GET', '/dependencies?scope=everything');
	assert.equal(invalid.status, 400);
	assert.equal(invalid.body.error.code, 'SCOPE_INVALID');
	const unknown = await scenario.request('GET', '/dependencies?scope=member:apps/none');
	assert.equal(unknown.status, 404);
	assert.equal(unknown.body.error.code, 'SCOPE_NOT_FOUND');
});

test('the preflight finds a source for each declaration, says how it is read, and skips a denied optional one', { timeout: 300000 }, async () => {
	const { started, operation } = await scenario.run('/dependencies/preflight', {});
	assert.equal(started.status, 202);
	assert.equal(started.headers.get('location'), `/operations/${operation.id}`);
	assert.equal(operation.kind, 'dependencies.preflight');
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	assert.deepEqual(operation.steps.map(({ id, state }) => [id, state]), [['declaration', 'done'], ['metadata', 'done'], ['evaluate', 'done']]);
	assert.deepEqual(operation.steps[1].counts, { done: 6, total: 6, unit: 'packages' });

	const { ready, dependencies, counts } = operation.result;
	assert.equal(ready, true);
	assert.deepEqual(counts, { declared: 10, available: 9, blocked: 0, unavailable: 0, skipped: 1, unverified: 0 });
	const find = (importer, name, type) => dependencies.find(one => one.importer === importer && one.name === name && (!type || one.type === type));
	assert.equal(find('apps/web', '@fixture/view').source, 'member');
	assert.equal(find('apps/admin', '@team/tokens').access, 'private');
	assert.equal(find('apps/admin', '@team/tokens').status, 'available');
	assert.equal(find('apps/admin', 'react').access, 'public');
	const secret = find('apps/admin', '@team/secret-sdk');
	assert.equal(secret.status, 'skipped', 'an optional dependency an installation would skip blocks nothing');
	assert.equal(secret.access, 'denied');
	assert.equal(secret.finding.code, 'PROVIDER_AUTH_DENIED');
	assert.equal(find('packages/view', 'react', 'peer').version, '19.1.1');
	assert.throws(() => scenario.read('beyond-lock.json'), { code: 'ENOENT' }, 'a preflight writes nothing');
});

test('once installed, every node is located, and a shared node is listed once with both its dependents', { timeout: 300000 }, async () => {
	const installed = await scenario.request('POST', '/installation', { body: {} });
	assert.equal(installed.body.valid, true, JSON.stringify(installed.body));

	const described = await inventory();
	assert.equal(described.installation.state, 'ready');
	assert.equal(described.lock.digest, installed.body.lock.digest);
	for (const one of described.nodes.filter(({ source }) => source.kind === 'registry')) assert.equal(one.status, 'installed', one.key);
	assert.equal(node(described, '@team/tokens').visibility, 'private');
	assert.equal(node(described, '@team/secret-sdk').status, 'missing', 'the lock skipped the optional dependency');

	const shared = node(described, 'shared-lib', '1.0.0');
	const chart = node(described, 'chart-kit', '1.0.0');
	assert.deepEqual(shared.dependents.map(({ key }) => key).sort(), [chart.key, 'workspace:apps/web'].sort());

	// The node, what it reaches (nothing) and what reaches it: both dependents, and the member above the package
	const closure = await inventory(`node:${shared.key}`);
	const keys = closure.nodes.map(({ key }) => key);
	assert.equal(keys[0], shared.key, 'the scope starts at its node');
	assert.deepEqual([...keys].sort(), [shared.key, chart.key, 'workspace:apps/admin', 'workspace:apps/web'].sort());

	const admin = await inventory('member:apps/admin');
	const names = admin.nodes.map(({ name }) => name).sort();
	assert.deepEqual(names, ['@fixture/admin', '@team/tokens', 'chart-kit', 'js-tokens', 'loose-envify', 'react', 'shared-lib']);
	assert.equal(admin.counts.scope, admin.nodes.length);
});

test('a check is read-only: what the ranges admit, the latest release, a deprecation, and how each was read', { timeout: 300000 }, async () => {
	await scenario.publish('shared-lib@1.1.0');
	await scenario.publish('chart-kit@1.2.0');
	const [lock, manifest] = [scenario.read('beyond-lock.json'), scenario.read('apps/admin/package.json')];

	const { operation } = await scenario.run('/dependencies/checks', { scope: 'workspace' });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	assert.deepEqual(operation.steps.map(({ id, state }) => [id, state]), [['metadata', 'done'], ['compare', 'done']]);
	const { nodes, counts } = operation.result;
	assert.deepEqual(operation.steps[0].counts, { done: counts.packages, total: counts.packages, unit: 'packages' });

	const shared = nodes.find(({ name }) => name === 'shared-lib');
	assert.deepEqual([shared.current, shared.wanted, shared.latest], ['1.0.0', '1.1.0', '2.0.0']);
	assert.deepEqual(shared.available, ['2.0.0', '1.1.0', '1.0.0']);
	assert.deepEqual(shared.ranges, ['^1.0.0']);
	const chart = nodes.find(({ name }) => name === 'chart-kit');
	assert.equal(chart.wanted, '1.2.0');
	assert.equal(chart.deprecated, 'chart-kit 1.0.0 draws axes twice: use 1.2.0');
	assert.equal(nodes.find(({ name }) => name === '@team/tokens').access, 'private');
	const secret = nodes.find(({ name }) => name === '@team/secret-sdk');
	assert.equal(secret.access, 'denied');
	assert.equal(secret.error.code, 'PROVIDER_AUTH_DENIED');
	assert.equal(counts.outdated, 2);
	assert.equal(counts.denied, 1);
	for (const one of nodes) assert.ok(Date.parse(one.checked) > 0, `${one.name} says when it was read`);

	assert.equal(scenario.read('beyond-lock.json'), lock, 'a check never touches the lock');
	assert.equal(scenario.read('apps/admin/package.json'), manifest, 'nor a manifest');

	const scoped = await scenario.run('/dependencies/checks', { scope: `node:${shared.key}` });
	assert.deepEqual(scoped.operation.result.nodes.map(({ name }) => name).sort(), ['chart-kit', 'shared-lib']);
	const missing = await scenario.request('POST', '/dependencies/checks', { body: { scope: 'member:apps/none' } });
	assert.equal(missing.status, 404);
});

test('a check that waits on a registry can be cancelled, and the same request identifier answers it again', { timeout: 300000 }, async () => {
	scenario.registries.public.hold('js-tokens');
	try {
		const headers = { 'idempotency-key': 'check-cancelled-0001' };
		const started = await scenario.request('POST', '/dependencies/checks', { body: { scope: 'workspace' }, headers });
		assert.equal(started.status, 202);
		const { id } = started.body.operation;
		const waiting = await scenario.operation(id, record => record.steps[0].state === 'progress' && record.cancellable);
		assert.ok(waiting.steps[0].counts.done < waiting.steps[0].counts.total, 'the held package is not read yet');

		const cancelled = await scenario.request('POST', `/operations/${id}/cancel`);
		assert.equal(cancelled.status, 202);
		const ended = await scenario.operation(id);
		assert.equal(ended.state, 'cancelled');
		assert.equal(ended.steps[0].state, 'failed');

		const again = await scenario.request('POST', '/dependencies/checks', { body: { scope: 'workspace' }, headers });
		assert.equal(again.status, 200);
		assert.equal(again.body.operation.id, id);
	} finally {
		scenario.registries.public.release('js-tokens');
	}
});
