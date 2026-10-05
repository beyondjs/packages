/**
 * The stores a local installation keeps on the user's disk: the metadata cache (`FilesystemMetadataStore` of
 * `@beyond-js/packages/providers`) and the source store (`FilesystemStore` of `@beyond-js/packages/sources`):
 * where a source's files are, the stages a process abandoned, a source whose files were removed, where an
 * installation keeps both by default, and that it records their real paths when links lead to them. Every value
 * is inline (small records and short files), except in the last two tests, which install the workspace of
 * `fixtures/installation` with the harness of `support/installation.mjs`.
 *
 * ```sh
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/stores.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { FilesystemMetadataStore } from '@beyond-js/packages/providers';
import { FilesystemStore } from '@beyond-js/packages/sources';
import { Installation } from '@beyond-js/packages/installation';
import { Execution } from '@beyond-js/packages/execution';
import { declare, install, setup, temporary } from './support/installation.mjs';

const KEY = 'public|packument|registry.example|react';

/**
 * Every file below a directory, relative to it
 */
const tree = async directory =>
	(await readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());

test('metadata records are kept between instances, by their whole key', async t => {
	const root = join(await temporary(t, 'beyond-stores-'), 'metadata');
	const document = {
		name: 'react',
		versions: { '19.1.1': { dist: { tarball: 'https://registry.example/react.tgz' } } }
	};
	await new FilesystemMetadataStore(root).set(KEY, {
		scope: 'public',
		document,
		cache: { etag: 'W/"1"', other: 'dropped' }
	});

	const store = new FilesystemMetadataStore(root);
	assert.deepEqual(await store.get(KEY), { scope: 'public', document, cache: { etag: 'W/"1"' } });
	assert.equal(
		await store.get('org:acme|packument|registry.example|react'),
		undefined,
		'another scope finds nothing'
	);
	assert.equal(await store.get(`${KEY}x`), undefined);

	await store.set(KEY, { scope: 'public', document: { name: 'react', versions: {} } });
	assert.deepEqual(await store.get(KEY), { scope: 'public', document: { name: 'react', versions: {} } });
	assert.throws(() => new FilesystemMetadataStore('relative/metadata'), /absolute/);
	await assert.rejects(store.set(KEY, { document: {} }), /scope/);
});

test('metadata records are replaced whole, readable by their owner only, and an unreadable one is a miss', async t => {
	const root = join(await temporary(t, 'beyond-stores-'), 'metadata');
	const store = new FilesystemMetadataStore(root);

	// Writes of one key at once leave one of them, whole
	const writes = Array.from({ length: 12 }, (_, index) => store.set(KEY, { scope: 'public', document: { index } }));
	await Promise.all(writes);
	const { document } = await store.get(KEY);
	assert.ok(Number.isInteger(document.index));

	const [file, ...others] = await tree(root);
	assert.deepEqual(others, [], 'no temporary file is left');
	const path = join(file.parentPath ?? file.path, file.name);
	assert.ok(file.name.endsWith('.json'));
	assert.equal((await stat(path)).mode & 0o777, 0o600);

	await writeFile(path, '{"protocol": "beyond-metadata/1", "key": ');
	assert.equal(await store.get(KEY), undefined, 'a truncated record is a miss');
	await writeFile(
		path,
		JSON.stringify({ protocol: 'beyond-metadata/1', key: 'other', scope: 'public', document: {} })
	);
	assert.equal(await store.get(KEY), undefined, 'a record of another key is a miss');
});

test('metadata documents reach the disk without the user information of their addresses', async t => {
	const root = join(await temporary(t, 'beyond-stores-'), 'metadata');
	const store = new FilesystemMetadataStore(root);
	const tarball = 'https://reader:s3cr3t@registry.example/npm/react/-/react-19.1.1.tgz';
	await store.set(KEY, { scope: 'org:local', document: { versions: { '19.1.1': { dist: { tarball } } } } });

	const [file] = await tree(root);
	const text = await readFile(join(file.parentPath ?? file.path, file.name), 'utf8');
	assert.ok(!text.includes('s3cr3t') && !text.includes('reader'));
	const { document } = await store.get(KEY);
	assert.equal(document.versions['19.1.1'].dist.tarball, 'https://registry.example/npm/react/-/react-19.1.1.tgz');
});

/**
 * Writes and commits a source of one file through the store's own interface
 */
async function commit(store, record, content = '{"name": "react"}') {
	const stage = await store.put(record);
	const bytes = await stage.write('package.json', Readable.from([content]));
	const files = { 'package.json': bytes };
	return await store.commit(stage, { ...record, bytes, extracted: bytes, entries: 1, files });
}

const record = () => {
	const integrity = `sha512-${createHash('sha512').update('react@19.1.1').digest('base64')}`;
	return { key: 'npm/react/19.1.1/x', scope: 'public', origin: 'npm', name: 'react', version: '19.1.1', integrity };
};

test('the store answers where the files of a source are', async t => {
	const store = new FilesystemStore(join(await temporary(t, 'beyond-stores-'), 'sources'));
	const location = store.location(record());
	assert.ok(location.startsWith(store.root) && location.endsWith('/files'));
	assert.equal(await store.has(record()), false);

	const committed = await commit(store, record());
	assert.equal(committed.location, location);
	assert.equal((await store.get(record())).location, location);
	assert.equal(await readFile(join(location, 'package.json'), 'utf8'), '{"name": "react"}');
	assert.notEqual(store.location({ ...record(), scope: 'org:acme' }), location, 'the scope is part of the location');
});

test('a source whose files were removed is not held, and fetching it again replaces it', async t => {
	const store = new FilesystemStore(join(await temporary(t, 'beyond-stores-'), 'sources'));
	const { location } = await commit(store, record());
	await rm(location, { recursive: true });

	assert.equal(await store.has(record()), false);
	assert.equal(await store.get(record()), undefined);
	const replaced = await commit(store, record(), '{"name": "react", "again": true}');
	assert.equal(replaced.location, location);
	assert.equal(await store.has(record()), true);
	assert.equal(JSON.parse(await readFile(join(location, 'package.json'), 'utf8')).again, true);

	// A source published meanwhile is the one kept: the second stage is discarded
	const kept = await commit(store, record(), '{"name": "react", "late": true}');
	assert.equal(kept.location, location);
	assert.equal(JSON.parse(await readFile(join(location, 'package.json'), 'utf8')).again, true);
	assert.deepEqual(await readdir(join(store.root, '.staging')), []);
});

test('stages abandoned longer than the download timeout are moved aside and removed; open and recent ones stay', async t => {
	const root = join(await temporary(t, 'beyond-stores-'), 'sources');
	const staging = join(root, '.staging');
	const age = async (name, milliseconds) => {
		const time = new Date(Date.now() - milliseconds);
		for (const path of [join(staging, name, 'files'), join(staging, name)]) {
			await utimes(path, time, time).catch(error => assert.equal(error.code, 'ENOENT'));
		}
	};
	for (const name of ['source-abandoned', 'source-recent', 'trash-left'])
		await mkdir(join(staging, name, 'files'), { recursive: true });
	await age('source-abandoned', 3600000);
	await mkdir(join(staging, 'unrelated'));

	// The first stage a store opens comes after one sweep, which also removes what an interrupted sweep left aside
	const store = new FilesystemStore(root, { timeout: 60000 });
	const open = await store.put(record());
	const others = async () => (await readdir(staging)).filter(name => !open.directory.endsWith(name)).sort();
	assert.deepEqual(await others(), ['source-recent', 'unrelated']);

	// A bound below the download timeout is never applied; past it, a stage open in this process still stays
	assert.equal(await store.clean(0), 0);
	await age('source-recent', 120000);
	await age(open.directory.split('/').pop(), 120000);
	assert.equal(await store.clean(), 1);
	assert.deepEqual(await others(), ['unrelated']);

	await store.discard(open);
	assert.deepEqual(await readdir(staging), ['unrelated']);
	assert.equal(
		await new FilesystemStore(join(root, 'absent')).clean(),
		0,
		'a store without stages has nothing to clean'
	);
});

test('a stage moved aside while it is written is never published, even when a later write recreates it', async t => {
	const store = new FilesystemStore(join(await temporary(t, 'beyond-stores-'), 'sources'));
	const stage = await store.put(record());
	const bytes = await stage.write('package.json', Readable.from(['{"name": "react"}']));

	// What another process's sweep does: one rename, and the owner keeps writing
	await rename(stage.directory, join(store.root, 'aside'));
	await stage.write('index.js', Readable.from(['export default 1;']));

	const source = {
		...record(),
		bytes,
		extracted: bytes,
		entries: 2,
		files: { 'package.json': bytes, 'index.js': 17 }
	};
	await assert.rejects(store.commit(stage, source), { code: 'STAGE_LOST' });
	assert.equal(await store.has(record()), false);
	assert.deepEqual(await readdir(join(store.root, '.staging')), [], 'the recreated stage is discarded');

	// A stage gone without being recreated is not recreated empty by the commit either
	const gone = await store.put(record());
	await rm(gone.directory, { recursive: true });
	await assert.rejects(store.commit(gone, { ...source, files: {} }), { code: 'STAGE_LOST' });
	assert.equal(await store.has(record()), false);
});

test('an installation keeps its stores where the variables say, else in the cache directory of the user', async t => {
	const { providers, workspace } = await setup(t);
	const home = await temporary(t, 'beyond-stores-');
	const saved = ['HOME', 'BEYOND_SOURCES_DIR', 'BEYOND_METADATA_DIR'].map(name => [name, process.env[name]]);
	t.after(() =>
		saved.forEach(([name, value]) => (value === void 0 ? delete process.env[name] : (process.env[name] = value)))
	);
	const located = async root => {
		const report = await install(new Installation({ ...(await declare(root)), providers }));
		assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
		return (await Execution.read(root)).execution.store;
	};

	// The user's cache is found from the home directory, which this test moves to a temporary one
	process.env.HOME = home;
	delete process.env.BEYOND_SOURCES_DIR;
	delete process.env.BEYOND_METADATA_DIR;
	const cache = await located(await workspace('cached'));
	assert.ok(cache.startsWith(home) && cache.endsWith('sources'), cache);
	assert.ok((await readdir(join(cache, '..', 'metadata'), { recursive: true })).length > 0);

	process.env.BEYOND_SOURCES_DIR = join(home, 'sources');
	process.env.BEYOND_METADATA_DIR = join(home, 'metadata');
	assert.equal(await located(await workspace('variables')), join(home, 'sources'));
	assert.ok((await readdir(join(home, 'metadata'))).length > 0);
});

test('an installation records real paths, whatever links lead to the store, the metadata cache or the members', async t => {
	const { base, providers, workspace } = await setup(t);
	const root = await workspace();
	const link = async (name, target) => (await symlink(target, join(base, name)), join(base, name));
	await mkdir(join(base, 'real-store'));
	await mkdir(join(base, 'real-metadata'));
	// The store root under the link does not exist yet: it is created, then recorded by its real path
	const store = join(await link('linked-store', join(base, 'real-store')), 'sources');
	const metadata = await link('linked-metadata', join(base, 'real-metadata'));
	const linked = await link('linked-workspace', root);

	const report = await install(new Installation({ ...(await declare(linked)), providers, store, metadata }));
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	const { execution, state } = await Execution.read(linked);
	assert.equal(state, 'ready');
	assert.deepEqual([execution.root, execution.store], [root, join(base, 'real-store', 'sources')]);
	for (const [key, { location }] of execution.nodes) assert.equal(location, await realpath(location), key);
	for (const { id, location } of execution.members.values()) assert.equal(location, join(root, id));
	const stored = [...execution.nodes.values()].filter(({ member }) => !member);
	assert.ok(stored.length && stored.every(({ location }) => location.startsWith(execution.store)));
	assert.ok((await readdir(join(base, 'real-metadata'))).length > 0, 'the metadata cache is in the real directory');
});
