/**
 * Every cloud template checks clean and compiles with this implementation, as CDN's source check and its
 * preparation run it: no error diagnostic in the semantic check of every TypeScript file, every public module and
 * stylesheet of the template generated, and every item of its inventory, its dependencies' included, generated
 * for delivery. Read the README of this directory.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" --test tests/templates/compile.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Catalog } from './support/catalog.mjs';
import { Store } from './support/store.mjs';
import { SourceCheck } from './support/source.mjs';

const compiler = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const catalog = await new Catalog().read();

/** The subpath of the public module each form names as its entry */
const SUBPATHS = { main: 'main', '.': '.' };

const errors = diagnostics => (diagnostics ?? []).filter(({ severity }) => severity !== 'warning');
const describe = value => String(JSON.stringify(value ?? null, null, 1)).slice(0, 4000);

for (const template of catalog.templates) {
	test(`template "${template.name}" checks clean and compiles`, { timeout: 900_000 }, async t => {
		const store = new Store();
		t.after(() => store.remove());
		await store.create(catalog.directory(template));
		const source = new SourceCheck(store, compiler);

		await t.test('it publishes the entry the catalog names, and nothing else', async () => {
			const modules = await source.modules();
			assert.deepEqual(modules.map(({ subpath }) => subpath), [SUBPATHS[template.entry]], describe(modules));
		});

		await t.test('the semantic check of every TypeScript file reports no error and resolves every type', async () => {
			const { programs, files } = await source.check();
			assert.ok(files.length > 0, 'the template has TypeScript files');
			assert.deepEqual(programs.flatMap(program => program.files).sort(), files, 'every file is in one program');
			for (const { directory, result } of programs) {
				assert.equal(result.complete, true, `the program of "${directory}" is checked whole: ${describe(result.outcome)}`);
				assert.deepEqual(errors(result.diagnostics), [], `the program of "${directory}" reports no error`);
				assert.deepEqual(result.summary.unresolved, [], `the program of "${directory}" has the types of every import`);
				assert.equal(result.summary.withheld, 0, `the program of "${directory}" withholds nothing`);
				assert.equal(result.summary.warnings, 0, `the program of "${directory}" reports no warning: ${describe(result.diagnostics)}`);
				t.diagnostic(`${template.name}: the program of "${directory}" checked ${result.measured?.program?.sources} sources with TypeScript ${result.measured?.program?.typescript}, strict ${result.measured?.program?.strict}`);
			}
		});

		await t.test('every public module and stylesheet of the template is generated, confined', async () => {
			const { inventory, generated } = await source.compile('own');
			assert.deepEqual(errors(inventory.diagnostics), [], `the trace reports no error: ${describe(inventory.diagnostics)}`);
			assert.ok(generated.some(({ item }) => item.kind === 'module'), 'the template has a module to generate');
			for (const { item, result } of generated) {
				assert.deepEqual(result.diagnostics, [], `${item.id} builds: ${describe(result.diagnostics)}`);
				const wanted = item.kind === 'style' ? 'css' : 'js';
				const output = result.outputs.find(one => one.key === item.key && one.kind === wanted);
				assert.ok(output, `${item.id} yields its ${wanted} output`);
				assert.equal(result.provenance?.compiler?.confined, true, `${item.id} was compiled confined`);
			}
		});

		await t.test('every item of its inventory is generated for delivery, its dependencies included', async () => {
			const { inventory, generated } = await source.compile('all');
			assert.deepEqual(errors(inventory.diagnostics), []);
			for (const { item, result } of generated) {
				assert.deepEqual(result.diagnostics, [], `${item.id} builds: ${describe(result.diagnostics)}`);
				assert.ok(result.outputs.some(one => one.key === item.key), `${item.id} yields an output under its key`);
			}
			t.diagnostic(`${template.name}: ${generated.length} items (${[...new Set(generated.map(({ item }) => item.package))].join(', ')})`);
		});
	});
}
