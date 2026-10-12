/**
 * Dependency management (`service/host/dependencies`) through its routes, over a copy of the fixtures of
 * `tests/dependencies` and the stand-ins of its `support/stage.mjs`: the File API, the `Installation` and `Execution` of
 * Packages, and the served workspace. What the real modules and host do is validated by `tests/dependencies`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Stage } from '../../tests/dependencies/support/stage.mjs';

const releases = (versions, extra = {}) => ({ found: true, registry: 'https://registry.npmjs.org/', access: 'public', versions, tags: { latest: versions[0] }, deprecated: {}, ...extra });

test('without the File API of the development extension the routes are not there and no capability is claimed', async t => {
	const bare = await Stage.start(t, { files: false });
	assert.deepEqual(bare.feature.capabilities, {});
	assert.equal((await bare.send('GET', '/dependencies')).status, 404);
	assert.equal((await bare.send('POST', '/dependencies/preflight', { body: {} })).status, 404);
	const served = await Stage.start(t);
	assert.deepEqual(served.feature.capabilities, { dependencies: 1 });
});

test('the inventory joins the lock, what each importer declares now and what the toolchain supplies', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready', supplied: ['widgets'] });
	const { status, body } = await stage.send('GET', '/dependencies');
	assert.equal(status, 200);
	const bytes = readFileSync(join(stage.root, 'beyond-lock.json'));
	assert.equal(body.base.lock, `sha256-${createHash('sha256').update(bytes).digest('hex')}`, 'the base names the bytes of the lock');
	assert.equal(body.lock.digest, JSON.parse(bytes).digest);
	assert.equal(body.installation.state, 'ready');

	const byKey = Object.fromEntries(body.nodes.map(node => [node.key, node]));
	assert.equal(byKey['npm:react@18.3.1'].status, 'installed');
	assert.deepEqual(byKey['npm:react@18.3.1'].source, { kind: 'registry', registry: 'https://registry.npmjs.org/' });
	assert.equal(byKey['registry-127-0-0-1-4873-team:@team/tokens@1.0.0'].visibility, 'private');
	assert.equal(byKey['declared:@team/secret-sdk'].status, 'missing', 'the optional dependency the lock skipped');
	assert.deepEqual(byKey['declared:@team/secret-sdk'].declared, [{ importer: 'apps/admin', range: '^1.0.0', type: 'optional' }]);
	const widgets = byKey['supplied:@beyond-js/widgets@1.1.0'];
	assert.deepEqual([widgets.status, widgets.source.kind, widgets.declared], ['supplied', 'supplied', []]);
	assert.deepEqual(byKey['npm:shared-lib@1.0.0'].dependents.map(({ key }) => key).sort(), ['npm:chart-kit@1.0.0', 'workspace:apps/web']);

	const view = (await stage.send('GET', '/dependencies?scope=member:packages/view')).body;
	assert.deepEqual(view.nodes.map(({ key }) => key).sort(), ['npm:js-tokens@4.0.0', 'npm:loose-envify@1.4.0', 'npm:react@18.3.1', 'workspace:apps/web', 'workspace:packages/view']);
	assert.equal(view.counts.nodes, body.nodes.length);
	const node = (await stage.send('GET', '/dependencies?scope=node:npm:scheduler@0.23.2')).body;
	assert.deepEqual(node.nodes.map(({ key }) => key), ['npm:scheduler@0.23.2', 'npm:loose-envify@1.4.0', 'npm:js-tokens@4.0.0', 'npm:react-dom@18.3.1', 'workspace:apps/web']);
	for (const [scope, code] of [['node:npm:none@1.0.0', 'SCOPE_NOT_FOUND'], ['package:react', 'SCOPE_INVALID'], ['member:', 'SCOPE_INVALID']]) {
		assert.equal((await stage.send('GET', `/dependencies?scope=${encodeURIComponent(scope)}`)).body.error.code, code, scope);
	}
});

test('a check answers what the ranges of each registry node admit, how its registry was read, and never writes', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.catalog = {
		'shared-lib': releases(['2.0.0', '1.1.0', '1.0.0']),
		'chart-kit': releases(['1.2.0', '1.0.0'], { deprecated: { '1.0.0': 'use 1.2.0' } }),
		react: releases(['19.1.1', '18.3.1']),
		'loose-envify': releases(['1.4.0']),
		'js-tokens': releases(['4.0.0']),
		'@team/tokens': releases(['1.0.0'], { access: 'private', registry: 'http://127.0.0.1:4873/' }),
		scheduler: { found: false, access: 'unknown', versions: [], tags: {}, deprecated: {}, error: { code: 'NETWORK_ERROR', message: 'The provider could not be reached' } },
		'@team/secret-sdk': { found: false, access: 'denied', versions: [], tags: {}, deprecated: {}, error: { code: 'PROVIDER_AUTH_DENIED', message: 'refused with status 403' } }
	};
	const lock = stage.read('beyond-lock.json');
	const operation = await stage.run('/dependencies/checks', { scope: 'workspace' });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	const { nodes, counts } = operation.result;
	const named = name => nodes.find(one => one.name === name);
	assert.deepEqual([named('shared-lib').wanted, named('shared-lib').latest, named('shared-lib').available], ['1.1.0', '2.0.0', ['2.0.0', '1.1.0', '1.0.0']]);
	assert.equal(named('chart-kit').deprecated, 'use 1.2.0');
	assert.deepEqual(named('react').ranges.sort(), ['^18.3.1', '^18.3.1 || ^19.0.0']);
	assert.equal(named('react').wanted, '18.3.1', 'the version every range that selects the node admits');
	assert.equal(named('@team/tokens').access, 'private');
	assert.deepEqual([named('scheduler').access, named('scheduler').error.code], ['unknown', 'NETWORK_ERROR']);
	assert.deepEqual([named('@team/secret-sdk').current, named('@team/secret-sdk').access], [null, 'denied']);
	assert.equal(named('react-dom').error.code, 'PACKAGE_NOT_FOUND');
	assert.deepEqual([counts.outdated, counts.denied, counts.failed], [2, 1, 3]);
	const [asked] = stage.installation.calls.filter(({ method }) => method === 'releases');
	assert.equal(new Set(asked.names).size, asked.names.length, 'each package is read once');
	assert.equal(stage.read('beyond-lock.json'), lock);
});

test('a check that waits on a registry is cancelled through its operation', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.hold();
	const started = await stage.send('POST', '/dependencies/checks', { body: {} });
	assert.equal(started.status, 202);
	const { id } = started.body.operation;
	await stage.ended(id, record => record.steps[0].state === 'progress');
	await stage.operations.cancel(id);
	const ended = await stage.ended(id);
	assert.deepEqual([ended.state, ended.steps[0].state, ended.steps[1].state], ['cancelled', 'failed', 'waiting']);
});

test('the preflight blocks what only the toolchain supplies, and tells denied, unreachable, unverified and skipped apart', async t => {
	const stage = await Stage.start(t, { fixture: 'hello', supplied: ['widgets', 'react-19-widgets'] });
	const manifest = JSON.parse(stage.read('app/package.json'));
	Object.assign(manifest.dependencies, { flaky: '^1.0.0', 'git-thing': 'github:org/repo#abc1234', '@team/secret-sdk': '^1.0.0' });
	manifest.optionalDependencies = { maybe: '^1.0.0' };
	stage.write('app/package.json', JSON.stringify(manifest, null, '\t'));
	stage.installation.catalog = {
		react: releases(['19.1.1']),
		'react-dom': releases(['19.1.1']),
		flaky: { found: false, access: 'unknown', versions: [], tags: {}, deprecated: {}, error: { code: 'NETWORK_ERROR', message: 'The provider could not be reached' } },
		'@team/secret-sdk': { found: false, access: 'denied', versions: [], tags: {}, deprecated: {}, error: { code: 'PROVIDER_AUTH_REQUIRED', message: 'refused with status 401' } }
	};

	const operation = await stage.run('/dependencies/preflight', {});
	const { ready, dependencies, counts } = operation.result;
	assert.equal(ready, false);
	const status = name => dependencies.find(one => one.name === name);
	const adapter = status('@beyond-js/react-19-widgets');
	assert.deepEqual([adapter.status, adapter.source, adapter.finding.code, adapter.range, adapter.importer], ['blocked', 'supplied', 'PACKAGE_NOT_FOUND', '^1.0.0', 'app']);
	assert.deepEqual(adapter.finding.supplied, { name: '@beyond-js/react-19-widgets', version: '1.0.0' });
	assert.equal(adapter.finding.recovery.length, 3);
	assert.deepEqual([status('react').status, status('react').version], ['available', '19.1.1']);
	assert.deepEqual([status('flaky').status, status('flaky').finding.code], ['unavailable', 'NETWORK_ERROR']);
	assert.deepEqual([status('@team/secret-sdk').status, status('@team/secret-sdk').access], ['blocked', 'denied']);
	assert.deepEqual([status('git-thing').status, status('git-thing').source], ['unverified', 'unverified']);
	assert.deepEqual([status('maybe').status, status('maybe').finding.code], ['skipped', 'PACKAGE_NOT_FOUND']);
	assert.deepEqual(counts, { declared: 8, available: 2, blocked: 3, unavailable: 1, skipped: 1, unverified: 1 });
});

test('a plan is refused before it starts when it is malformed, names nothing declared, or was read from another state', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	const { base } = (await stage.send('GET', '/dependencies')).body;
	const post = body => stage.send('POST', '/dependencies/plans', { body });
	const code = async body => (await post(body)).body.error.code;

	assert.equal((await stage.send('POST', '/dependencies/plans', { body: '{}', type: 'text/plain' })).status, 415);
	assert.equal(await code({ changes: [{ name: 'react' }], base, extra: true }), 'BODY_INVALID');
	for (const changes of [[], [{ name: 'not a name' }], [{ name: 'react', version: '^1.0.0' }], [{ name: 'react', range: '' }], [{ name: 'react' }, { name: 'react' }], [{ name: 'react', other: 1 }]]) {
		assert.equal(await code({ changes, base }), 'CHANGES_INVALID', JSON.stringify(changes));
	}
	assert.equal(await code({ changes: [{ name: 'react' }] }), 'BASE_REQUIRED');
	const undeclared = await post({ changes: [{ name: 'left-pad' }], base });
	assert.deepEqual([undeclared.status, undeclared.body.error.code], [422, 'CHANGE_UNDECLARED']);
	assert.equal(await code({ changes: [{ name: 'react', importer: 'apps/none', range: '^19.0.0' }], base }), 'CHANGE_UNDECLARED');
	const stale = await post({ changes: [{ name: 'react' }], base: { ...base, lock: 'absent' } });
	assert.deepEqual([stale.status, stale.body.error.code], [409, 'PLAN_STALE']);
	assert.deepEqual(stale.body.error.details.current, base);
	assert.equal(stage.installation.calls.length, 0, 'nothing was resolved');
	assert.equal((await stage.send('GET', '/dependencies/plans/pln_x')).status, 404);
});
