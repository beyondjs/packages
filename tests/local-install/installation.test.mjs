/**
 * The installation of a local workspace (`@beyond-js/packages/installation`) against an npm-compatible registry
 * in process: it resolves the whole workspace, fetches the external sources into the user's store, and only then
 * writes the lock and the execution projection. The workspace and the registry releases are the checked-in
 * files of `fixtures/installation` (see its README); each test copies them to its own temporary directory with
 * the harness of `support/installation.mjs`.
 *
 * ```sh
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/installation.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Execution } from '@beyond-js/packages/execution';
import { Canonical } from '@beyond-js/packages/resolution';
import { FakeRegistry } from '../cdn-resolution/registry.mjs';
import { RELEASES, NONE, codes, declare, edit, files, install, json, publish, setup } from './support/installation.mjs';

test('a first installation resolves, fetches, and only then writes the lock and the projection', async t => {
	const { registry, store, workspace, create } = await setup(t);
	const root = await workspace();
	const report = await install(await create(root));

	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.equal(report.frozen, false);
	assert.deepEqual(report.counts, { members: 2, nodes: 6, fetched: 4, reused: 0 });
	assert.deepEqual([report.lock.written, report.execution.written], [true, true]);
	assert.deepEqual(registry.requests, { packument: 4, manifest: 0, tarball: 4, other: 0 });
	assert.ok(
		!registry.log.some(({ path }) => path.includes('@fixture')),
		'no request names a package the workspace owns'
	);

	const text = await readFile(report.lock.path, 'utf8');
	const lock = JSON.parse(text);
	assert.deepEqual([lock.protocol, lock.digest], ['beyond-lock/2', report.lock.digest]);
	assert.equal(text, `${JSON.stringify(lock, null, 2)}\n`);
	assert.ok(!text.includes(root) && !text.includes(store), 'the lock names no path of this machine');
	assert.deepEqual(lock.inputs, (await declare(root)).inputs);

	const { execution, state } = await Execution.read(root, { inputs: lock.inputs });
	assert.equal(state, 'ready');
	assert.equal(execution.lock, report.lock.digest);
	assert.equal(execution.resolve('workspace:app', '@fixture/widgets').node.location, join(root, 'widgets'));
	const a = execution.resolve('workspace:app', 'lib-a').node;
	assert.ok(a.location.startsWith(store));
	assert.equal((await json(join(a.location, 'package.json'))).version, '1.0.0');
	assert.equal(execution.resolve(a.key, 'lib-c').node.version, '1.0.0');
	assert.equal(execution.resolve('workspace:widgets', 'lib-b').node.name, 'lib-b');
	// The development dependencies of the members are installed as well
	assert.equal(execution.resolve('workspace:app', 'lib-dev').node.version, '1.0.0');
	assert.equal(execution.resolve('workspace:app', 'lib-b').error.code, 'DEPENDENCY_NOT_INSTALLED');
});

test('a frozen reinstallation makes no request and reuses every source', async t => {
	const { registry, workspace, create } = await setup(t);
	const root = await workspace();
	const first = await install(await create(root));
	registry.reset();

	const report = await install(await create(root));
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.equal(report.frozen, true);
	assert.deepEqual(registry.requests, NONE);
	assert.deepEqual(report.counts, { members: 2, nodes: 6, fetched: 0, reused: 4 });
	assert.deepEqual(report.lock, { ...first.lock, written: false });
	assert.equal(report.execution.written, true);
	assert.equal((await Execution.read(root)).state, 'ready');
});

test('another workspace reuses the stored sources, and a committed lock installs frozen on a new store', async t => {
	const { registry, base, providers, workspace, create } = await setup(t);
	const first = await workspace('first');
	await install(await create(first));

	registry.reset();
	const second = await workspace('second');
	const report = await install(await create(second));
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.deepEqual([report.frozen, registry.requests.tarball, report.counts.reused], [false, 0, 4]);
	const location = async root =>
		(await Execution.read(root)).execution.resolve('workspace:app', 'lib-a').node.location;
	assert.equal(await location(second), await location(first));

	// The lock of the first workspace, committed and checked out elsewhere, on another machine's empty store
	const third = await workspace('third');
	await cp(join(first, 'beyond-lock.json'), join(third, 'beyond-lock.json'));
	registry.reset();
	const elsewhere = { store: join(base, 'other-store'), metadata: join(base, 'other-metadata'), providers };
	const frozen = await install(await create(third, elsewhere));
	assert.equal(frozen.valid, true, JSON.stringify(frozen.diagnostics));
	assert.equal(frozen.frozen, true);
	assert.deepEqual(registry.requests, { ...NONE, tarball: 4 });
	assert.ok((await location(third)).startsWith(join(base, 'other-store')));
});

test('an update selects newer releases, which a frozen installation does not', async t => {
	const { registry, workspace, create } = await setup(t);
	const root = await workspace();
	const first = await install(await create(root));
	await publish(registry, 'lib-c@1.1.0');
	const version = async () => {
		const { execution } = await Execution.read(root);
		return execution.resolve(execution.resolve('workspace:app', 'lib-a').key, 'lib-c').node.version;
	};

	registry.reset();
	const frozen = await install(await create(root));
	assert.deepEqual([frozen.valid, frozen.frozen, await version()], [true, true, '1.0.0']);
	assert.deepEqual(registry.requests, NONE);

	const updated = await install(await create(root), { update: true });
	assert.equal(updated.valid, true, JSON.stringify(updated.diagnostics));
	assert.equal(updated.frozen, false);
	assert.equal(updated.lock.written, true);
	assert.notEqual(updated.lock.digest, first.lock.digest);
	assert.deepEqual([updated.counts.fetched, updated.counts.reused], [1, 3]);
	assert.equal(await version(), '1.1.0');
	assert.equal((await Execution.read(root, { inputs: (await declare(root)).inputs })).state, 'ready');
});

test('offline installs a frozen lock from the store, and refuses anything else without writing', async t => {
	const { registry, base, providers, workspace, create } = await setup(t);
	const root = await workspace();
	await install(await create(root));
	registry.reset();

	const offline = await install(await create(root), { offline: true });
	assert.deepEqual([offline.valid, offline.frozen], [true, true], JSON.stringify(offline.diagnostics));
	const before = await files(root);

	// The lock covers the inputs, but this store does not hold the sources
	const elsewhere = { store: join(base, 'empty-store'), metadata: join(base, 'empty-metadata'), providers };
	const missing = await install(await create(root, elsewhere), { offline: true });
	assert.equal(missing.valid, false);
	assert.equal(codes(missing)[0], 'OFFLINE_UNAVAILABLE');
	const named = missing.diagnostics.filter(({ code, node }) => code === 'OFFLINE_UNAVAILABLE' && node);
	assert.deepEqual(named.map(({ node }) => node.split(':').pop()).sort(), RELEASES);

	// The inputs changed: a resolution is needed, which makes requests
	await edit(root, 'widgets', manifest => ({
		...manifest,
		dependencies: { ...manifest.dependencies, 'lib-c': '^1.0.0' }
	}));
	const changed = await install(await create(root), { offline: true });
	assert.deepEqual([changed.valid, changed.frozen, codes(changed)], [false, false, ['OFFLINE_UNAVAILABLE']]);
	assert.deepEqual([changed.lock.written, changed.execution.written], [false, false]);

	assert.deepEqual(registry.requests, NONE);
	assert.deepEqual(await files(root), before);
});

test('a registry that cannot be reached or a package it does not have leaves the installation as it was', async t => {
	const { registry, providers, workspace, create } = await setup(t);
	const root = await workspace();
	const first = await install(await create(root));
	const before = await files(root);

	const closed = await new FakeRegistry({ prefix: '/npm' }).start();
	const address = closed.url;
	await closed.stop();
	const unreachable = { providers: { ...providers, values: { default: { registry: address } } } };
	const outage = await install(await create(root, unreachable), { update: true });
	assert.equal(outage.valid, false);
	assert.equal(codes(outage)[0], 'GRAPH_INCOMPLETE');
	assert.deepEqual(outage.lock, { ...first.lock, written: false });
	assert.equal(outage.execution.written, false);

	await edit(root, 'app', manifest => ({
		...manifest,
		dependencies: { ...manifest.dependencies, 'lib-missing': '^1.0.0' }
	}));
	registry.reset();
	const absent = await install(await create(root));
	assert.equal(absent.valid, false);
	assert.equal(codes(absent)[0], 'GRAPH_INCOMPLETE');
	assert.ok(
		absent.diagnostics.some(({ message }) => message.includes('lib-missing')),
		JSON.stringify(absent.diagnostics)
	);
	assert.equal(registry.requests.tarball, 0, 'nothing is fetched from an incomplete graph');

	assert.deepEqual(await files(root), before);
	assert.equal(
		(await Execution.read(root)).state,
		'ready',
		'the previous projection still describes the previous lock'
	);
});

test('a corrupt or interrupted archive is SOURCES_INCOMPLETE, stores nothing, and a retry recovers', async t => {
	const { registry, base, providers, workspace, create } = await setup(t);
	const root = await workspace();
	await install(await create(root));
	const before = await files(root);

	// The same lock fetched into a new store: the archives are downloaded again
	const store = join(base, 'new-store');
	const elsewhere = { store, metadata: join(base, 'new-metadata'), providers };
	for (const fault of ['corrupt', 'truncate']) {
		registry.fault('lib-b', '1.0.0', fault);
		const report = await install(await create(root, elsewhere));
		assert.equal(report.valid, false, fault);
		assert.equal(codes(report)[0], 'SOURCES_INCOMPLETE', fault);
		const failed = report.diagnostics.filter(({ node }) => node);
		assert.deepEqual(
			failed.map(({ node }) => node.split(':').pop()),
			['lib-b@1.0.0'],
			fault
		);
		assert.deepEqual(await files(root), before, fault);
		assert.deepEqual(await readdir(join(store, '.staging')).catch(() => []), [], `${fault}: no stage is left`);
	}

	registry.fault('lib-b', '1.0.0');
	const retry = await install(await create(root, elsewhere));
	assert.equal(retry.valid, true, JSON.stringify(retry.diagnostics));
	assert.deepEqual([retry.counts.fetched, retry.counts.reused], [1, 3], 'the sources verified before are kept');
	const { execution } = await Execution.read(root);
	assert.ok(execution.resolve('workspace:widgets', 'lib-b').node.location.startsWith(store));
});

test('installations called together on one instance run one after the other', async t => {
	const { registry, workspace, create } = await setup(t);
	const root = await workspace();
	const installation = await create(root);

	const [first, second] = await Promise.all([install(installation), install(installation)]);
	assert.deepEqual([first.valid, first.frozen], [true, false], JSON.stringify(first.diagnostics));
	// The second found the lock the first wrote
	assert.deepEqual([second.valid, second.frozen], [true, true], JSON.stringify(second.diagnostics));
	assert.equal(registry.requests.tarball, 4);
});

test('the projection goes stale with changed inputs or lock, incomplete without a source, and an installation repairs it', async t => {
	const { workspace, create } = await setup(t);
	const root = await workspace();
	await install(await create(root));
	const { inputs } = await declare(root);

	const changed = { ...inputs, members: { ...inputs.members, app: Canonical.digest({ edited: true }) } };
	const edited = await Execution.read(root, { inputs: changed });
	assert.deepEqual([edited.state, edited.diagnostics[0].details.changed], ['stale', ['member:app']]);

	const path = join(root, 'beyond-lock.json');
	const lock = await readFile(path, 'utf8');
	await writeFile(path, lock.replace('"range": "^1.0.0"', '"range": "^1.0.1"'));
	const relocked = await Execution.read(root, { inputs });
	assert.deepEqual([relocked.state, relocked.diagnostics[0].details.changed], ['stale', ['lock']]);
	await writeFile(path, lock);

	const { execution } = await Execution.read(root, { inputs });
	const b = execution.resolve('workspace:widgets', 'lib-b').node;
	await rm(b.location, { recursive: true });
	const incomplete = await Execution.read(root, { inputs });
	assert.equal(incomplete.state, 'incomplete');
	assert.deepEqual(
		incomplete.diagnostics.map(({ code, node }) => [code, node]),
		[['SOURCE_MISSING', b.key]]
	);

	// The store no longer holds lib-b: the frozen reinstallation fetches it again
	const repaired = await install(await create(root));
	assert.deepEqual([repaired.valid, repaired.frozen, repaired.counts.fetched], [true, true, 1]);
	assert.equal((await Execution.read(root, { inputs })).state, 'ready');
});

test('a lock of the previous format is read as preferences, and an unreadable one is set aside', async t => {
	const { registry, workspace, create } = await setup(t);
	await publish(registry, 'lib-c@1.1.0');
	const root = await workspace();
	const path = join(root, 'beyond-lock.json');
	const legacy = {
		'lib-c@1.0.0': { name: 'lib-c', version: { specified: '^1.0.0', resolved: '1.0.0' }, kind: 'main' }
	};
	await writeFile(path, JSON.stringify(legacy));

	const report = await install(await create(root));
	assert.deepEqual(
		[report.valid, report.frozen, report.lock.written],
		[true, false, true],
		JSON.stringify(report.diagnostics)
	);
	assert.equal((await json(path)).protocol, 'beyond-lock/2');
	const { execution } = await Execution.read(root);
	assert.equal(execution.resolve(execution.resolve('workspace:app', 'lib-a').key, 'lib-c').node.version, '1.0.0');

	await writeFile(path, '<<<<<<< a merge conflict');
	const unreadable = await install(await create(root));
	assert.deepEqual([unreadable.valid, unreadable.frozen, codes(unreadable)], [true, false, ['LOCK_UNREADABLE']]);
	assert.equal(unreadable.diagnostics[0].severity, 'warning');
	assert.equal((await json(path)).digest, unreadable.lock.digest);
});
