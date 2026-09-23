/**
 * Output selection: an import selects the JavaScript output of a public module, and an explicit `.css`
 * selects its stylesheet — the literal subpath when the package publishes one, the stylesheet of the module
 * named without it otherwise — as a style relation that is removed from the code.
 *
 * `fixtures/selector` (`@fixture/selector`, Beyond sources compiled by the selected compiler) has one entry
 * module per way of selecting; `fixtures/sheets` (`fixture-sheets`, an ordinary npm package) publishes
 * stylesheets under several spellings. Read the README of this directory.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/cdn-analysis/outputs.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Analysis } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';
import { Store, Selected } from './store.mjs';

const compiler = Selected.compiler;
const conditions = { platform: 'browser', environment: 'development' };
const SELECTOR = 'npm:@fixture/selector@1.0.0';
const SHEETS = 'npm:fixture-sheets@1.0.0';

test('output selection', async t => {
	const store = new Store();
	await store.create();
	t.after(() => store.destroy());
	await store.copy(SELECTOR, '@fixture/selector', '1.0.0', 'selector');
	await store.copy(SHEETS, 'fixture-sheets', '1.0.0', 'sheets');
	const graph = store.graph;
	graph.edges.push(Store.edge(SELECTOR, SHEETS));
	Store.seal(graph);
	const { sources } = store;

	const trace = entry => Analysis.trace({ graph, sources, entries: [`@fixture/selector/${entry}`], conditions, compiler });
	const ids = inventory => inventory.items.map(({ id }) => id);
	const errors = inventory => inventory.diagnostics.filter(({ severity }) => severity === 'error');
	const code = (inventory, id) => errors(inventory).find(diagnostic => diagnostic.code === id);

	await t.test('a literal .css subpath is that style module, reached as a style relation of the code', async () => {
		const inventory = await trace('literal');
		assert.deepEqual(errors(inventory), []);
		const sheet = inventory.items.find(({ id }) => id === `style:${SHEETS}/base.css`);
		assert.deepEqual([sheet?.loading, sheet?.importers], ['eager', [`module:${SELECTOR}/literal`]]);

		const item = inventory.items.find(({ id }) => id === `module:${SELECTOR}/literal`);
		const unit = await Generation.unit({ item, graph, sources, conditions, format: 'esm', compiler });
		const js = unit.outputs.find(({ kind }) => kind === 'js');
		assert.doesNotMatch(js.code, /base\.css/, 'the stylesheet is not imported by the code');
		assert.deepEqual(js.relations.references.find(({ kind }) => kind === 'style'), { specifier: 'fixture-sheets/base.css', kind: 'style', package: SHEETS, subpath: 'base.css', builtin: undefined });
	});

	await t.test('.css selects the stylesheet of the module named without it', async () => {
		const inventory = await trace('stripped');
		assert.deepEqual(errors(inventory), []);
		assert.ok(ids(inventory).includes(`style:${SHEETS}/theme`), ids(inventory).join(', '));
	});

	await t.test('one module published under both spellings is one selection, and the literal subpath names it', async () => {
		const inventory = await trace('same');
		assert.deepEqual(errors(inventory), []);
		assert.ok(ids(inventory).includes(`style:${SHEETS}/dual.css`));
		assert.ok(!ids(inventory).includes(`style:${SHEETS}/dual`));
	});

	await t.test('two different modules for one .css selection are ambiguous, and nothing is guessed', async () => {
		const inventory = await trace('ambiguous');
		assert.match(code(inventory, 'OUTPUT_AMBIGUOUS')?.message ?? JSON.stringify(inventory.diagnostics), /"fixture-sheets\/tone\.css" is ambiguous/);
		assert.ok(!ids(inventory).some(id => id.includes('tone') || id.includes('other')));
	});

	await t.test('a stylesheet no module publishes, and the stylesheet of a module that produces none, are not found', async () => {
		assert.ok(code(await trace('missing'), 'OUTPUT_NOT_FOUND'));
		const sheetless = await trace('sheetless');
		assert.match(code(sheetless, 'OUTPUT_NOT_FOUND')?.message ?? JSON.stringify(sheetless.diagnostics), /produces none/);
	});

	await t.test('a style module imported without .css has no JavaScript output, and the error names the specifier to write', async () => {
		const inventory = await trace('unselected');
		assert.match(code(inventory, 'OUTPUT_NOT_FOUND')?.message ?? JSON.stringify(inventory.diagnostics), /import "fixture-sheets\/theme\.css"/);
	});

	await t.test('an import that asks a stylesheet for a value, or for a CSS module script, is refused', async () => {
		for (const entry of ['binding', 'attribute']) {
			const inventory = await trace(entry);
			assert.ok(code(inventory, 'STYLE_BINDING_UNSUPPORTED'), `${entry}: ${JSON.stringify(inventory.diagnostics)}`);
		}
	});

	await t.test('.js states the JavaScript output of the module named without it', async () => {
		const inventory = await trace('script');
		assert.deepEqual(errors(inventory), []);
		assert.ok(ids(inventory).includes(`module:${SHEETS}/code`));
	});

	await t.test('the stylesheet of a module selected alone is its style item, without its code, keyed as with its code', async () => {
		const alone = await trace('alone');
		assert.deepEqual(errors(alone), []);
		assert.ok(ids(alone).includes(`style:${SELECTOR}/sheet`));
		assert.ok(!ids(alone).includes(`module:${SELECTOR}/sheet`), 'its code is not loaded');

		const both = await trace('sheet');
		const key = inventory => inventory.items.find(({ id }) => id === `style:${SELECTOR}/sheet`).key;
		assert.equal(key(alone), key(both), 'the stylesheet has one key however it was reached');

		const item = alone.items.find(({ id }) => id === `style:${SELECTOR}/sheet`);
		const unit = await Generation.unit({ item, graph, sources, conditions, format: 'esm', compiler });
		assert.deepEqual(unit.diagnostics, []);
		assert.match(unit.outputs.find(({ kind }) => kind === 'css').code, /rgb\(6, 6, 6\)/);
	});

	await t.test('a module left without imports or exports still registers in the system format', async () => {
		const inventory = await trace('effect');
		assert.deepEqual(errors(inventory), []);

		const item = inventory.items.find(({ id }) => id === `module:${SELECTOR}/effect`);
		const unit = await Generation.unit({ item, graph, sources, conditions, format: 'system', compiler });
		assert.deepEqual(unit.diagnostics, []);
		const js = unit.outputs.find(({ kind }) => kind === 'js');
		assert.match(js.code, /^System\.register\(/, 'a SystemJS loader refuses a plain script');
		assert.match(js.code, /effect = true/);
		assert.doesNotMatch(js.code, /sheet\.css/, 'the stylesheet is not imported by the code');
	});
});
