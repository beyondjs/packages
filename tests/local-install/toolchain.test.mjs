/**
 * The toolchain as an explicit source of an installation (`toolchain` of `@beyond-js/packages/installation`): a
 * release no registry publishes and the Beyond toolchain carries as an archive is installed from it, recorded in the
 * lock with the origin `toolchain`, its archive address and the integrity of the archive; a release a registry
 * publishes is always the registry's; an outage is never hidden behind the toolchain; a tampered or missing archive
 * fails naming the release. The workspace and the archives are `fixtures/toolchain` (see its README).
 *
 * ```sh
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/toolchain.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Execution } from '@beyond-js/packages/execution';
import { codes, install, json } from './support/installation.mjs';
import { archive, repack, setup } from './support/toolchain.mjs';

const RUNTIME = 'toolchain:@fixture/runtime@1.0.0';

const integrity = async file => `sha512-${createHash('sha512').update(await readFile(file)).digest('base64')}`;

test('a release only the toolchain carries is installed from its archive and recorded as the toolchain', async t => {
	const { registry, root, store, archives, create } = await setup(t);
	const report = await install(await create());
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));

	const text = await readFile(report.lock.path, 'utf8');
	const lock = JSON.parse(text);
	const node = lock.nodes[RUNTIME];
	assert.ok(node, `the lock has ${RUNTIME}: ${Object.keys(lock.nodes)}`);
	assert.deepEqual(node.origin, { provider: 'toolchain' });
	assert.equal(node.tarball, RUNTIME);
	assert.equal(node.integrity, await integrity(archive(archives, '@fixture/runtime', '1.0.0')));
	assert.equal(node.visibility, 'public');
	assert.ok(!text.includes(archives) && !text.includes(root) && !text.includes(store), 'the lock names no path of this machine');

	// What the supplied release depends on comes from the registry, and the registry was asked for the name first
	assert.ok(Object.keys(lock.nodes).some(key => key.endsWith(':lib-b@1.0.0') && !key.startsWith('toolchain:')));
	assert.ok(registry.log.some(({ path }) => path.includes('@fixture%2fruntime') || path.includes('@fixture/runtime')));

	const { execution, state } = await Execution.read(root, { inputs: lock.inputs });
	assert.equal(state, 'ready');
	const supplied = execution.resolve('workspace:.', '@fixture/runtime').node;
	assert.ok(supplied.location.startsWith(store));
	assert.match(await readFile(join(supplied.location, 'index.js'), 'utf8'), /supplied by the toolchain/);
	assert.equal(execution.resolve(supplied.key, 'lib-b').node.name, 'lib-b');
});

test('a frozen installation from another store reads the same archive and writes the same lock', async t => {
	const { base, create } = await setup(t);
	const first = await install(await create());
	assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
	const before = await readFile(first.lock.path, 'utf8');

	const again = await install(await create({ store: join(base, 'another-store') }));
	assert.equal(again.valid, true, JSON.stringify(again.diagnostics));
	assert.equal(again.frozen, true);
	assert.equal(await readFile(again.lock.path, 'utf8'), before);
});

test('a release a registry publishes is the registry\'s, whatever the toolchain carries', async t => {
	const { create, root } = await setup(t);
	const manifest = await json(join(root, 'package.json'));
	await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, 'lib-c': '1.0.0' } }));

	const report = await install(await create());
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	const lock = await json(report.lock.path);
	const keys = Object.keys(lock.nodes).filter(key => key.endsWith(':lib-c@1.0.0'));
	assert.equal(keys.length, 1);
	assert.notEqual(lock.nodes[keys[0]].origin.provider, 'toolchain');
});

test('without the toolchain, the release is not found and nothing is written', async t => {
	const { create, root } = await setup(t);
	const report = await install(await create({ toolchain: false }));
	assert.equal(report.valid, false);
	assert.ok(codes(report).includes('GRAPH_INCOMPLETE'), JSON.stringify(report.diagnostics));
	assert.ok(report.diagnostics.some(({ message }) => message.includes('@fixture/runtime')));
	await assert.rejects(readFile(join(root, 'beyond-lock.json')));
});

test('a registry that does not answer is an outage, never resolved from the toolchain', async t => {
	const { create, registry } = await setup(t);
	await registry.stop();
	const report = await install(await create());
	assert.equal(report.valid, false);
	assert.ok(!codes(report).every(code => code === 'TOOLCHAIN_ARCHIVE_MISSING'));
	assert.equal(report.lock.written ?? false, false);
});

test('a lock whose supplied archive is missing or was replaced fails naming the release', async t => {
	const { base, archives, create } = await setup(t);
	const first = await install(await create());
	assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
	const missing = await install(await create({ store: join(base, 'store-missing'), toolchain: false }));
	assert.equal(missing.valid, false);
	assert.ok(codes(missing).includes('TOOLCHAIN_ARCHIVE_MISSING'), JSON.stringify(missing.diagnostics));
	assert.ok(missing.diagnostics.some(({ message }) => message.includes('@fixture/runtime@1.0.0')));

	// The same release packed with other bytes: the integrity the lock records refuses it
	await repack(t, archives, 'runtime@1.0.0', 'index.js', "export const runtime = 'replaced';\n");
	const tampered = await install(await create({ store: join(base, 'store-tampered') }));
	assert.equal(tampered.valid, false);
	assert.ok(codes(tampered).includes('INTEGRITY_MISMATCH'), JSON.stringify(tampered.diagnostics));
});

test('an archive that cannot be read is left out with a warning, and the others still supply', async t => {
	const { archives, create } = await setup(t);
	await writeFile(join(archives, 'broken-0.0.1.tgz'), 'not an archive');
	const report = await install(await create());
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	const warning = report.diagnostics.find(({ code }) => code === 'TOOLCHAIN_ARCHIVE_UNREADABLE');
	assert.ok(warning, JSON.stringify(report.diagnostics));
	assert.equal(warning.severity, 'warning');
	assert.ok(!warning.message.includes(archives), 'the warning names the file, not the directory');
	await rm(join(archives, 'broken-0.0.1.tgz'));
});

test('a Beyond package no registry has says how to get it', async t => {
	const { create, root } = await setup(t);
	const manifest = await json(join(root, 'package.json'));
	await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, dependencies: { '@beyond-js/unpublished': '1.0.0' } }));

	const report = await install(await create({ toolchain: false }));
	assert.equal(report.valid, false);
	const missing = report.diagnostics.find(({ code }) => code === 'PACKAGE_NOT_FOUND');
	assert.ok(missing, JSON.stringify(report.diagnostics));
	assert.match(missing.message, /@beyond-js\/unpublished/);
	assert.match(missing.message, /Beyond command line/);
});

test('the releases of a name say which versions only the toolchain carries', async t => {
	const { create } = await setup(t);
	const installation = await create();
	const [runtime, a] = await installation.releases(['@fixture/runtime', 'lib-a']);
	assert.deepEqual([runtime.found, runtime.versions, runtime.supplied], [true, ['1.0.0'], ['1.0.0']]);
	assert.equal(a.supplied, undefined);
});
