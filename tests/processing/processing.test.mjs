/**
 * A conditional or a processor that fails answers with a diagnostic instead of stranding whoever waits for it.
 *
 * The dynamic processor settles the readiness of a conditional only when a processing returns: before these
 * guards, a conditional that threw or rejected, or a processor whose build threw, left `Delivery.module` — and the
 * HTTP request behind it — pending forever. The workspace of `fixtures/workspace` is compiled by the fixture
 * bundler of `fixtures/bundler`, whose conditionals fail in each of those ways; read the README of the fixtures.
 * `ConditionalOutput`, the code and map of every output, answers an output without code instead of throwing.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/processing/processing.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { ConditionalOutput } from '@beyond-js/packages/module/output';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const BUNDLER = new URL('./fixtures/bundler/module.mjs', import.meta.url).href;
const WEB = { platform: 'web', environment: 'development' };

let root, workspace, delivery;
before(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-processing-')));
	await cp(join(FIXTURES, 'workspace'), root, { recursive: true });
	// The one substitution: where the fixture bundler is, which only the run knows
	const manifest = join(root, 'fixture/package.json');
	await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('FIXTURE_BUNDLER', BUNDLER));
	workspace = new Workspace(root);
	delivery = new Delivery(workspace);
});
after(async () => {
	workspace?.destroy();
	root && (await rm(root, { recursive: true, force: true }));
});

/**
 * The delivery of one module of the fixture, which must answer within a bounded wait
 */
const module = async subpath => {
	let timer;
	const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${subpath} never answered`)), 30000)));
	try {
		return await Promise.race([delivery.module({ name: '@fixture/processing', version: '1.0.0', subpath }, WEB), limit]);
	} finally {
		clearTimeout(timer);
	}
};
const codes = failure => (failure.diagnostics ?? []).map(({ code }) => code);

test('a conditional that processes answers its code', async () => {
	const { delivered, failure } = await module('./sound');
	assert.equal(failure, undefined, JSON.stringify(failure));
	assert.equal(delivered.code('none'), "export const name = 'sound';\n");
});

test('a conditional whose processing throws answers BUILD_FAILED with PROCESSING_FAILED, never pending', async () => {
	const { delivered, failure } = await module('./thrown');
	assert.equal(delivered, undefined);
	assert.equal(failure.code, 'BUILD_FAILED');
	assert.deepEqual(codes(failure), ['PROCESSING_FAILED']);
	assert.match(failure.message, /thrown by the fixture/);
});

test('a conditional whose processing rejects answers BUILD_FAILED with PROCESSING_FAILED, never pending', async () => {
	const { failure } = await module('./rejected');
	assert.equal(failure.code, 'BUILD_FAILED');
	assert.deepEqual(codes(failure), ['PROCESSING_FAILED']);
	assert.match(failure.message, /rejected by the fixture/);
});

test('a processor whose build throws is a PROCESSOR_FAILED diagnostic of its conditional, never pending', async () => {
	const { failure } = await module('./faulty');
	assert.equal(failure.code, 'BUILD_FAILED');
	assert.deepEqual(codes(failure), ['PROCESSOR_FAILED']);
	assert.match(failure.message, /the build of the fixture processor throws/);
});

test('a failure of one module leaves the others of its package deliverable', async () => {
	const { delivered } = await module('./sound');
	assert.ok(delivered?.hash);
});

test('an output without code answers undefined for its code and its hash, and a map that is not JSON is no map', () => {
	const empty = new ConditionalOutput();
	empty.set({ code: undefined, map: undefined });
	assert.equal(empty.hash, undefined);
	assert.equal(empty.code(), undefined);
	assert.equal(empty.code('sourcemap-inline'), undefined);

	const sheetless = new ConditionalOutput();
	sheetless.set({ code: 'export {};\n', map: 'not a map' });
	assert.match(sheetless.hash, /^[0-9a-f]{32}$/);
	assert.equal(sheetless.map('object'), undefined);
	assert.equal(sheetless.code('raw-code'), 'export {};\n');
});
