/**
 * Stylesheets of composed modules: an explicit `.css` selects the stylesheet of a public module as a style
 * relation, and a widget of a package that publishes `./global` reaches that shared sheet on its own.
 *
 * The application of the preparation validation (`fixture/`, `@fixture/cards`, which publishes `./global`)
 * and `fixtures/bare` (`@fixture/bare`, which does not) are traced and generated with the Beyond packages of
 * the suite, as a consumer prepares them. Read the README of this directory.
 *
 * ```sh
 * BEYOND_MODULES=/absolute/path/to/an/installation/node_modules \
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> \
 *   node --import "$BEE_NODE_DIR/register.mjs" --test tests/preparation/styles.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Analysis, Toolchain } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';
import { Store } from './store.mjs';

const compiler = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const conditions = { platform: 'browser', environment: 'development' };
const BARE = fileURLToPath(new URL('./fixtures/bare/', import.meta.url));

test('stylesheets of composed modules', { timeout: 900_000 }, async t => {
	const store = await new Store().create();
	t.after(() => rm(store.root, { recursive: true, force: true }));
	const { key: bare } = await store.add('@fixture/bare', BARE);
	const cards = store.key('@fixture/cards');
	const { graph, sources } = store;

	const trace = entries => Analysis.trace({ graph, sources, entries, conditions, compiler, format: 'esm' });
	const errors = inventory => inventory.diagnostics.filter(({ severity }) => severity === 'error');
	const generate = (inventory, id) => Generation.unit({ item: inventory.items.find(item => item.id === id), graph, sources, conditions, format: 'esm', compiler });

	await t.test('a widget prepared alone reaches the shared stylesheet of its package, which its code relates to', async () => {
		const inventory = await trace(['@fixture/cards/html']);
		assert.deepEqual(errors(inventory), []);
		const global = inventory.items.find(({ id }) => id === `style:${cards}/global`);
		assert.ok(global, `the shared sheet is an item: ${inventory.items.map(({ id }) => id).join(', ')}`);
		assert.deepEqual([global.loading, global.importers], ['eager', [`module:${cards}/html`]]);

		const sheet = await generate(inventory, global.id);
		assert.deepEqual(sheet.diagnostics, []);
		assert.match(sheet.outputs.find(({ kind }) => kind === 'css').code, /:host/, 'the shared sheet is generated');

		const code = (await generate(inventory, `module:${cards}/html`)).outputs.find(({ kind }) => kind === 'js');
		assert.deepEqual([code.relations.widget, code.relations.global], [true, { package: cards, subpath: 'global' }]);
		assert.match(code.code, /"global":true/, 'the registration tells Widgets to adopt it');
	});

	await t.test('a widget of a package without a shared stylesheet reaches none, and nothing is requested for one', async () => {
		const inventory = await trace(['@fixture/bare/badge']);
		assert.deepEqual(errors(inventory), []);
		assert.deepEqual(inventory.items.filter(({ id }) => id.endsWith('/global')).map(({ id }) => id), []);

		const code = (await generate(inventory, `module:${bare}/badge`)).outputs.find(({ kind }) => kind === 'js');
		assert.equal(code.relations.widget, true);
		assert.equal(code.relations.global, undefined);
		assert.doesNotMatch(code.code, /"global":true/, 'Widgets links no shared sheet for it');
		assert.ok(inventory.items.some(({ id }) => id === `style:${bare}/badge`), 'its own stylesheet is an item');
	});

	await t.test('a composed module that imports a stylesheet without .css is refused with the specifier to write', async () => {
		const inventory = await trace(['@fixture/bare/wrong']);
		const found = errors(inventory).find(({ code }) => code === 'OUTPUT_NOT_FOUND');
		assert.ok(found, JSON.stringify(inventory.diagnostics));
		assert.match(found.message, /"@fixture\/cards\/global\.css"/);
	});

	await t.test('a composed module that asks a stylesheet for a value is refused', async () => {
		const inventory = await trace(['@fixture/bare/binding']);
		const codes = errors(inventory).map(({ code }) => code);
		assert.ok(codes.includes('STYLE_BINDING_UNSUPPORTED'), JSON.stringify(inventory.diagnostics));
	});

	await t.test('composed outputs are keyed by composition 3', async () => {
		assert.equal(Toolchain.COMPOSITION, '3');
		const inventory = await trace(['@fixture/cards/entry']);
		const composed = inventory.items.filter(({ inputs }) => inputs.compiler.name === '@beyond-js/packages/bundlers/ts');
		assert.ok(composed.length > 5, `${composed.length} composed items`);
		assert.deepEqual([...new Set(composed.map(({ inputs }) => inputs.compiler.version))], ['3']);
	});
});
