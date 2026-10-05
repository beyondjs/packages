/**
 * How an installation of a local workspace (`@beyond-js/packages/installation`) fails and recovers: locks edited by
 * hand or by another person's registry login, writes that cannot finish, registries that do not answer, and caches or
 * stores that cannot be written. The workspace and the registry releases are the checked-in files of
 * `fixtures/installation` (see its README), copied by the harness of `support/installation.mjs`; the edits, faults and
 * the black-hole server below are inline.
 *
 * ```sh
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/installation.failures.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Execution } from '@beyond-js/packages/execution';
import { Canonical } from '@beyond-js/packages/resolution';
import { FakeRegistry } from '../cdn-resolution/registry.mjs';
import { codes, declare, files, install, json, publish, setup } from './support/installation.mjs';

/**
 * Rewrites the lock of a root after a change, with the digest of its new content when `sealed`
 */
async function relock(root, change, sealed = false) {
	const path = join(root, 'beyond-lock.json');
	const lock = await json(path);
	change(lock);
	if (sealed) {
		const { digest, ...content } = lock;
		lock.digest = Canonical.digest(content);
	}
	await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
}

const state = async root => (await Execution.read(root, { inputs: (await declare(root)).inputs })).state;

test('a lock edited outside what it records, or reordered, is rewritten and the projection is ready again', async t => {
	const { workspace, create } = await setup(t);
	const root = await workspace();
	await install(await create(root));

	for (const edit of [lock => (lock.$comment = 'added by hand'), lock => lock.edges.reverse()]) {
		await relock(root, edit);
		assert.equal(await state(root), 'stale');
		const report = await install(await create(root));
		assert.deepEqual([report.valid, report.frozen, report.lock.written], [true, false, true]);
		assert.deepEqual(codes(report), ['LOCK_UNREADABLE']);
		assert.match(report.diagnostics[0].message, /keeping its selections/);
		assert.equal(await state(root), 'ready');
		assert.equal((await json(join(root, 'beyond-lock.json'))).$comment, undefined);
	}

	const again = await install(await create(root));
	assert.deepEqual([again.valid, again.frozen, again.lock.written, codes(again)], [true, true, false, []]);
});

test('everyone who resolves the workspace writes the same lock, with or without a registry login', async t => {
	const { registry, providers, workspace, create } = await setup(t);
	const plain = await workspace('plain');
	const login = await workspace('login');
	const token = { mode: 'token', token: 'npm_fixtureToken' };
	const logged = { ...providers, values: { default: { registry: registry.url, auth: token } } };

	assert.equal((await install(await create(plain))).valid, true);
	assert.equal((await install(await create(login, { providers: logged }))).valid, true);
	const [a, b] = await Promise.all([plain, login].map(root => readFile(join(root, 'beyond-lock.json'), 'utf8')));
	assert.equal(b, a);
	assert.ok(!a.includes('"access"') && !b.includes('npm_fixtureToken'));
});

test('a lock that cannot be the graph is resolved again, keeping its selections, never trusted', async t => {
	const { registry, workspace, create } = await setup(t);
	const root = await workspace();
	await install(await create(root));
	await publish(registry, 'lib-c@1.1.0');
	const c = async () => {
		const { execution } = await Execution.read(root);
		return execution.resolve(execution.resolve('workspace:app', 'lib-a').key, 'lib-c').node.version;
	};

	const unsound = [
		[lock => (lock.edges[0].context = null), /a context that names no node/],
		[
			lock => (lock.members.app.node = Object.keys(lock.nodes).find(key => !key.startsWith('workspace:'))),
			/own node/
		],
		[lock => (lock.digest = Canonical.digest({ forged: true })), /digest it records is not its own/]
	];
	for (const [edit, why] of unsound) {
		await relock(root, edit, !String(why).includes('digest'));
		const report = await install(await create(root));
		assert.deepEqual([report.valid, report.frozen, codes(report)], [true, false, ['LOCK_UNREADABLE']]);
		assert.match(report.diagnostics[0].message, why);
		assert.deepEqual([await c(), await state(root)], ['1.0.0', 'ready'], 'the selections of the lock are kept');
	}
});

test('a write that cannot finish says exactly what it wrote, and temporary files stay in .beyond', async t => {
	const { registry, workspace, create } = await setup(t);
	const root = await workspace();
	const beyond = join(root, '.beyond');
	const temporary = async () =>
		[...(await readdir(root)), ...(await readdir(beyond).catch(() => []))].filter(name => name.endsWith('.tmp'));

	// Nothing can be prepared where .beyond is a file, so nothing is written
	await writeFile(beyond, 'a file where the directory goes');
	const blocked = await install(await create(root));
	assert.deepEqual([blocked.valid, codes(blocked)[0]], [false, 'INSTALLATION_WRITE_FAILED']);
	assert.deepEqual([blocked.lock.written, blocked.execution.written], [false, false]);
	assert.match(blocked.diagnostics[0].message, /nothing was written/);
	assert.deepEqual(await files(root), [null, null]);
	await rm(beyond);

	const first = await install(await create(root));
	assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
	assert.equal(await readFile(join(beyond, '.gitignore'), 'utf8'), '*\n', 'the projection is never committed');

	// The projection cannot be put in place after the new lock was
	await publish(registry, 'lib-c@1.1.0');
	await rm(join(root, Execution.PATH));
	await mkdir(join(root, Execution.PATH, 'occupied'), { recursive: true });
	const partial = await install(await create(root), { update: true });
	assert.deepEqual([partial.valid, codes(partial)[0]], [false, 'INSTALLATION_WRITE_FAILED']);
	assert.deepEqual([partial.lock.written, partial.execution.written], [true, false]);
	assert.match(partial.diagnostics[0].message, /^The lock was written, but .*execution\.json could not be written/);
	assert.notEqual(partial.lock.digest, first.lock.digest);
	assert.equal(partial.lock.digest, (await json(join(root, 'beyond-lock.json'))).digest);
	assert.equal((await Execution.read(root)).state, 'incompatible');
	assert.deepEqual(await temporary(), []);
});

test('a registry that cannot be reached is asked once, and every other request to it fails at once', async t => {
	const { providers, workspace, create } = await setup(t);
	const closed = await new FakeRegistry({ prefix: '/npm' }).start();
	const address = closed.url;
	await closed.stop();

	const requested = [];
	const transport = (url, init) => (requested.push(url), fetch(url, init));
	const values = { default: { registry: address } };
	const root = await workspace();
	const report = await install(await create(root, { providers: { ...providers, values }, transport }));
	assert.deepEqual([report.valid, codes(report)[0]], [false, 'GRAPH_INCOMPLETE']);
	assert.equal(report.diagnostics.filter(({ code }) => code === 'NETWORK_ERROR').length, 3);
	assert.equal(requested.length, 1, `requested: ${requested.join(', ')}`);
	assert.deepEqual(await files(root), [null, null]);
});

test('an installation never outlives its deadline: it answers INSTALLATION_TIMEOUT and writes nothing', async t => {
	const { providers, workspace, create } = await setup(t);
	// A registry that accepts connections and never answers
	const sockets = new Set();
	const server = createServer(() => {});
	server.on('connection', socket => (sockets.add(socket), socket.on('close', () => sockets.delete(socket))));
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => (sockets.forEach(socket => socket.destroy()), new Promise(resolve => server.close(resolve))));

	const values = { default: { registry: `http://127.0.0.1:${server.address().port}/npm` } };
	const root = await workspace();
	const installation = await create(root, { providers: { ...providers, values }, deadline: 1500 });
	const started = Date.now();
	const report = await install(installation);
	const elapsed = Date.now() - started;
	assert.ok(elapsed >= 1400 && elapsed < 10000, `answered after ${elapsed} ms`);
	assert.deepEqual([report.valid, codes(report)[0]], [false, 'INSTALLATION_TIMEOUT']);
	assert.match(report.diagnostics[0].message, /within 1.5 s: nothing was written/);
	assert.deepEqual(await files(root), [null, null]);

	// The requests still running were aborted: the next installation of the instance starts and ends too
	const next = await install(installation);
	assert.equal(codes(next)[0], 'INSTALLATION_TIMEOUT');
	assert.deepEqual(await files(root), [null, null]);
});

test('a metadata cache that cannot be used or written is a warning, never a registry failure', async t => {
	const { registry, base, workspace, create } = await setup(t);
	await writeFile(join(base, 'blocked'), 'a file where the cache directory goes');
	const root = await workspace();
	const report = await install(await create(root, { metadata: join(base, 'blocked', 'metadata') }));
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.deepEqual(codes(report), ['METADATA_CACHE_UNAVAILABLE']);
	assert.match(report.diagnostics[0].message, /blocked\/metadata cannot be used \(ENOTDIR\)/);
	assert.equal(registry.requests.packument, 4);
});

test('a source store that cannot be used fails the installation with its cause, writing nothing', async t => {
	const { base, workspace, create } = await setup(t);
	await writeFile(join(base, 'blocked'), 'a file where the store goes');
	const root = await workspace();
	const report = await install(await create(root, { store: join(base, 'blocked', 'sources') }));
	assert.deepEqual([report.valid, codes(report)[0]], [false, 'INSTALLATION_FAILED']);
	assert.match(report.diagnostics[0].message, /source store .*blocked\/sources cannot be used \(ENOTDIR\)/);
	assert.deepEqual(await files(root), [null, null]);
});

// File permissions do not stop a privileged user, so there is nothing to observe then
const skip = process.getuid?.() === 0 && 'root ignores file permissions';

test('a store or a metadata cache without write permission keeps its cause', { skip }, async t => {
	const { registry, base, workspace, create } = await setup(t);
	const [store, metadata] = ['locked-store', 'locked-metadata'].map(name => join(base, name));
	for (const directory of [store, metadata]) await mkdir(directory, { mode: 0o500 });

	registry.reset();
	const root = await workspace();
	const report = await install(await create(root, { store, metadata }));
	// Writable again before anything is asserted, so the temporary directory is always removed
	for (const directory of [store, metadata]) await chmod(directory, 0o700);

	assert.deepEqual([report.valid, codes(report)[0]], [false, 'SOURCES_INCOMPLETE']);
	const stored = report.diagnostics.filter(({ code }) => code === 'SOURCE_STORE_UNAVAILABLE');
	assert.equal(stored.filter(({ message }) => message.includes('(EACCES)')).length, 4, JSON.stringify(stored));
	const cache = report.diagnostics.find(({ code }) => code === 'METADATA_CACHE_UNAVAILABLE');
	assert.match(cache?.message ?? '', /could not be written \(EACCES\)/);
	assert.equal(registry.requests.tarball, 0, 'no archive is requested for a store that cannot keep it');
	assert.deepEqual(await files(root), [null, null]);
});
