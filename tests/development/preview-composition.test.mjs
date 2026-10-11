/**
 * The composition document over the real delivery of `fixtures/contract`: packages, public modules with their outputs
 * per platform, and public dependencies, in three lists kept apart, valid against the `composition` definition of
 * the contract. Under `externals: cdn` an output on the CDN carries what the stand-in CDN answered (`prepared`, the
 * digest of its entity tag), and the package the page takes from the CDN while Node resolves it from the installation
 * is `mixed`. The route and its access are the hosting service's (`GET /preview/composition.json`, `inspect.read`).
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/preview-composition.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import { Origins } from '@beyond-js/packages/http/routes';
import { Served } from './support/served.mjs';
import { Origin } from '../preview/browser.mjs';

const served = new Served();
before(() => served.start());
after(() => served.stop());

const schema = JSON.parse(readFileSync(new URL('../../contracts/development/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
ajv.addSchema(schema);
const valid = document => {
	const validate = ajv.getSchema(`${schema.$id}#/$defs/composition`);
	assert.ok(validate(document), JSON.stringify(validate.errors));
};

const registry = await new Origins().registry('https://packages.example.test/npm');
const PACKAGES = ['@fixture/app', '@fixture/composed', '@fixture/legacy'];
const LIBRARY = { root: '/m/library@2.0.0/modules/~root', legacy: `/m/${registry}/library@1.2.0/modules/~root` };

const extension = async (t, origin) => {
	const { Development } = await import('@beyond-js/packages/development');
	origin ? (process.env.BEYOND_CDN_ORIGIN = origin) : delete process.env.BEYOND_CDN_ORIGIN;
	t.after(() => delete process.env.BEYOND_CDN_ORIGIN);
	const created = new Development({ delivery: served.facade, settings: { root: served.root } });
	t.after(async () => {
		created.stop();
		await created.selection.clear();
	});
	return created;
};

const find = (list, id) => list.find(one => one.id === id);

test('composition: packages, public modules and their dependencies apart, each output by platform', async t => {
	const { preview } = await extension(t);
	const composed = await preview.composition('@fixture/app/main');
	valid(composed);

	assert.equal(composed.protocol, 'beyond-dev-composition/1');
	assert.deepEqual(composed.entry, { specifier: '@fixture/app/main', vspecifier: '@fixture/app@1.0.0/main' });
	assert.deepEqual(composed.selection, { explicit: false, externals: 'environment' });

	// Packages: each once, by source and provider, with what its manifest declares and the versions reached
	const app = find(composed.packages, '@fixture/app@1.0.0');
	assert.deepEqual([app.source, app.provider], ['workspace', 'workspace']);
	const declared = Object.fromEntries(app.dependencies.map(({ name, range, kind, resolved }) => [name, [range, kind, resolved]]));
	assert.deepEqual(declared['@fixture/legacy'], ['1.0.0', 'dependencies', ['1.0.0']]);
	assert.deepEqual(declared.library, ['2.0.0', 'dependencies', ['2.0.0']]);
	assert.deepEqual(declared.tool[2], [], 'a declared package nothing reaches resolves to no version');
	const legacy = find(composed.packages, '@fixture/legacy@1.0.0');
	assert.deepEqual(legacy.dependencies.map(({ name, resolved }) => [name, resolved]), [['library', ['1.2.0']]]);

	// The two installations of `library` stay two packages, the second one named by its registry
	const libraries = composed.packages.filter(({ name }) => name === 'library');
	const described = libraries.map(({ id, source, provider, registry: from }) => [id, source, provider, from]);
	assert.deepEqual(described.sort((a, b) => a[0].localeCompare(b[0])), [
		['library@2.0.0', 'environment', 'installation', 'npm'],
		[`${registry}:library@1.2.0`, 'environment', 'installation', registry]
	]);

	// Modules: the outputs of every platform a module declares, built here with their hashes
	const main = find(composed.modules, '@fixture/app@1.0.0/main');
	assert.deepEqual([main.loaded, main.platforms, main.package], [true, ['web', 'node'], '@fixture/app@1.0.0']);
	assert.deepEqual([main.outputs.web.source, main.outputs.web.state, main.outputs.node.state], ['workspace', 'built', 'built']);
	assert.ok(main.outputs.web.hash && main.outputs.node.hash && main.outputs.web.address.startsWith('../m/@fixture/app@1.0.0/modules/main?target=browser'));
	assert.ok(main.outputs.node.address.includes('target=node'), main.outputs.node.address);
	const other = find(composed.modules, '@fixture/composed@1.0.0/main');
	assert.deepEqual([other.loaded, other.platforms], [false, ['node']], 'a module the page does not load is described by its Node output');

	// Edges: the public imports of each platform, between module identities
	const edges = composed.edges.map(({ from, to, platform }) => `${platform} ${from} -> ${to}`);
	for (const expected of [
		'web @fixture/app@1.0.0/main -> @fixture/legacy@1.0.0/main',
		'web @fixture/app@1.0.0/main -> library@2.0.0',
		`web @fixture/legacy@1.0.0/main -> ${registry}:library@1.2.0`,
		'node @fixture/app@1.0.0/main -> @fixture/legacy@1.0.0/main',
		`node @fixture/legacy@1.0.0/main -> ${registry}:library@1.2.0`
	]) assert.ok(edges.includes(expected), `${expected} in ${JSON.stringify(edges, null, 1)}`);
	const ids = new Set(composed.modules.map(({ id }) => id));
	assert.ok(composed.edges.every(({ from, to }) => ids.has(from) && ids.has(to)), 'every edge joins two described modules');

	// A visitor of the preview reads it: no location of this machine, whatever the module of a diagnostic
	const text = JSON.stringify(composed);
	for (const location of [served.root, tmpdir(), homedir()]) assert.ok(!text.includes(location), `the document names ${location}`);
});

test('composition: under cdn an output on the CDN carries what the CDN answered, and a package the page and Node take from two places is mixed', async t => {
	const origin = new Origin();
	const code = path => `export const version = '${path}';`;
	[LIBRARY.root, LIBRARY.legacy].forEach(path => origin.module(path, code(path)));
	await origin.start();
	t.after(() => origin.stop());

	const { selection, preview } = await extension(t, origin.origin);
	await selection.replace({ packages: PACKAGES, externals: 'cdn' });
	const composed = await preview.composition('@fixture/app/main');
	valid(composed);

	const library = find(composed.modules, 'library@2.0.0');
	const digest = `sha256-${createHash('sha256').update(code(LIBRARY.root)).digest('hex')}`;
	assert.deepEqual([library.outputs.web.source, library.outputs.web.state, library.outputs.web.digest], ['cdn', 'prepared', digest]);
	assert.equal(library.outputs.web.hash, void 0, 'the hash of this environment\'s build is not the CDN\'s output');
	assert.deepEqual([library.outputs.node.source, library.outputs.node.state], ['environment', 'unknown']);
	assert.equal(find(composed.packages, 'library@2.0.0').source, 'mixed');
	assert.equal(find(composed.packages, '@fixture/app@1.0.0').source, 'workspace');

	// A service that checks after the CDN stopped holding the output
	origin.forget(LIBRARY.root);
	const missing = await (await extension(t, origin.origin)).preview.composition('@fixture/app/main');
	valid(missing);
	const web = find(missing.modules, 'library@2.0.0').outputs.web;
	assert.deepEqual([web.source, web.state, web.address], ['unresolved', 'missing', undefined]);
	assert.equal(find(missing.modules, 'library@2.0.0').loaded, false, 'the page does not load what has no address');
	assert.ok(missing.diagnostics.some(({ code: reported }) => reported === 'PREVIEW_CDN_MISSING'));
});
