/**
 * Public modules that share a directory compile only what their entry imports (DEV-02).
 *
 * The inputs of a `ts` module are the files of its directory, so two public modules declared through `exports` with
 * entry points in one directory compiled each other's sources, and each artifact evaluated the other's top-level
 * code. A module that shares its directory is now made of the internal modules its entry reaches and warns with
 * `MODULES_SHARE_DIRECTORY`; a module whose directory is its own keeps every file of it. The workspace is a copy of
 * `fixtures/workspace`; read the README of the fixtures.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/overlap/overlap.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';

const FIXTURES = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
const NODE = { platform: 'node', environment: 'development' };

let root, workspace, delivery;
before(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-overlap-')));
	await cp(FIXTURES, root, { recursive: true });
	workspace = new Workspace(root);
	delivery = new Delivery(workspace);
});
after(async () => {
	workspace?.destroy();
	root && (await rm(root, { recursive: true, force: true }));
});

/**
 * The delivery of one module, within a bounded wait
 */
const module = async (name, subpath) => {
	let timer;
	const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${name}${subpath} never answered`)), 60000)));
	try {
		const { delivered, failure } = await Promise.race([delivery.module({ name, version: '1.0.0', subpath }, NODE), limit]);
		assert.equal(failure, undefined, JSON.stringify(failure));
		return delivered;
	} finally {
		clearTimeout(timer);
	}
};

/**
 * The internal modules an artifact registers, by identity
 */
const ims = delivered => [...delivered.code('none').matchAll(/__ims\.set\('([^']+)'/g)].map(([, id]) => id).sort();
const codes = delivered => (delivered.warnings ?? []).map(({ code }) => code);

test('a module whose entry shares a directory holds what its entry imports, and warns', async () => {
	const main = await module('@fixture/shared', './main');
	assert.deepEqual(ims(main), ['./index', './math'], 'the entry and what it imports; not the file nobody imports');
	assert.deepEqual(codes(main), ['MODULES_SHARE_DIRECTORY']);
	assert.match(main.warnings[0].message, /"\.\/main" shares its directory "main" with "\.\/math"/);
});

test('the other module of the directory does not hold the first one\'s entry, so its top-level code runs once', async () => {
	const math = await module('@fixture/shared', './math');
	assert.deepEqual(ims(math), ['./math']);
	assert.deepEqual(codes(math), ['MODULES_SHARE_DIRECTORY']);
	assert.match(math.warnings[0].message, /"\.\/math" shares its directory "main" with "\.\/main"/);
});

test('a module whose directory is its own keeps every file of it, without a warning', async () => {
	const own = await module('@fixture/own', './lib');
	assert.deepEqual(ims(own), ['./helper', './index']);
	assert.deepEqual(codes(own), []);
});
