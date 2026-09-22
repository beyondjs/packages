/**
 * Preparation validation: a package is prepared according to the compilation contract it declares.
 *
 * A Beyond package declares which bundler compiles its public modules, which processors read their sources
 * and which runtime its composed artifacts are written against. Whoever prepares that package for delivery
 * must honour that declaration: preparing it with another compiler produces something the package never
 * described. Widgets, the framework controllers and an application that uses all four of them are the cases
 * this validation prepares, because their contract covers stylesheets, framework sources, widget
 * registration and a runtime.
 *
 * ```sh
 * BEYOND_MODULES=/absolute/path/to/an/installation/node_modules \
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/preparation/index.mjs [<output directory>]
 * ```
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { Publication } from '@beyond-js/packages/publication';
import { results, step } from '../stage-1/harness.mjs';
import { Browser } from '../preview/browser.mjs';
import { Store } from './store.mjs';
import { Prepared } from './prepared.mjs';
import { Delivered, document, shown } from './consumer.mjs';

const compiler = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const conditions = { platform: 'browser', environment: 'development' };

const store = await new Store().create();
const CARDS = store.key('@fixture/cards');
const WIDGETS = store.key('@beyond-js/widgets');
const ENTRY = '@fixture/cards/entry';

let prepared;
let delivered;
let browser;
let origin;
let page;
let observed = { errors: [], refused: [] };
const reported = [];

try {
	await step('publication: a package that declares Beyond sources and no publication form is named, not guessed', async () => {
		const bundler = { name: '@scope/ui', version: '1.0.0', beyond: { modules: '.', bundler: 'ts' } };
		const read = Publication.read(bundler);
		assert.equal(read.form, 'npm', 'the manifest says it is an ordinary npm package');
		assert.equal(read.diagnostics[0]?.code, 'PUBLICATION_UNDECLARED');

		const declared = Publication.read({ ...bundler, beyond: { ...bundler.beyond, publication: { protocol: 'beyond-publication/1', form: 'source' } } });
		assert.equal(declared.form, 'source');
		assert.deepEqual(declared.diagnostics, []);

		const ordinary = Publication.read({ name: 'react', version: '19.2.0' });
		assert.equal(ordinary.form, 'npm');
		assert.deepEqual(ordinary.diagnostics, [], 'a package that declares nothing is not warned about');
		return `${read.diagnostics[0]?.code} for a declared bundler; nothing for an ordinary package`;
	});

	await step('inventory: every module of the application, of Widgets and of the controllers is reached', async () => {
		prepared = await Prepared.of(store, compiler, ['@fixture/cards/entry'], conditions, 'esm');
		const errors = prepared.inventory.diagnostics.filter(({ severity }) => severity === 'error');
		assert.deepEqual(errors, [], errors.map(({ code, message }) => `${code}: ${message}`).join('\n'));

		const modules = prepared.inventory.items.filter(({ kind }) => kind === 'module').map(({ id }) => id);
		for (const subpath of ['entry', 'react', 'vue', 'svelte', 'html']) {
			assert.ok(modules.includes(`module:${CARDS}/${subpath}`), `the application publishes ${subpath}: ${modules.join(', ')}`);
		}
		assert.ok(modules.some(id => id.startsWith(`module:${WIDGETS}/`)), 'Widgets is reached');
		for (const controller of ['@beyond-js/react-19-widgets', '@beyond-js/vue-widgets', '@beyond-js/svelte-widgets']) {
			assert.ok(modules.some(id => id.startsWith(`module:${store.key(controller)}/`)), `${controller} is reached`);
		}
		return `${prepared.inventory.items.length} items, ${modules.length} modules`;
	});

	await step('composition: a module of a package that declares a bundler is compiled by that bundler', async () => {
		const item = prepared.inventory.items.find(({ id }) => id === `module:${CARDS}/react`);
		const { compiler: described } = item.inputs;
		assert.equal(described.name, '@beyond-js/packages/bundlers/ts', 'the key names the declared bundler');

		const unit = prepared.units.get(item.id);
		assert.deepEqual(unit.diagnostics, [], JSON.stringify(unit.diagnostics));
		assert.equal(unit.provenance.compiler.name, '@beyond-js/packages/bundlers/ts');

		const js = unit.outputs.find(({ kind }) => kind === 'js');
		assert.match(js.code, /widgets\.register\(\[/, 'the artifact registers the element the manifest declares');
		assert.match(js.code, /"name":"card-react"/, 'with the name of the element');
		assert.ok(js.relations.references.some(({ specifier }) => specifier === '@beyond-js/local-2026/bundle'), 'the runtime is a reference');
		assert.ok(js.relations.references.every(({ specifier, package: node }) => node || specifier.startsWith('node:')), 'every reference lands in the graph');
		return `${described.name}@${described.version}, ${js.relations.references.length} references`;
	});

	await step('processors: the stylesheet of every family is an output of its module', async () => {
		for (const [subpath, colour] of [['react', 'rgb(8, 145, 178)'], ['vue', 'rgb(22, 163, 74)'], ['svelte', 'rgb(147, 51, 234)'], ['html', 'rgb(217, 119, 6)']]) {
			const unit = prepared.units.get(`module:${CARDS}/${subpath}`);
			const css = unit.outputs.find(one => one.kind === 'css');
			assert.ok(css, `${subpath} produces a stylesheet: ${JSON.stringify(unit.diagnostics)}`);
			assert.ok(css.code.includes(colour), `the stylesheet of ${subpath} carries its compiled colour: ${css.code}`);
			assert.ok(prepared.inventory.items.some(({ id }) => id === `style:${CARDS}/${subpath}`), `${subpath} has a style item`);
		}
		const global = prepared.units.get(`style:${CARDS}/global`) ?? prepared.units.get(`module:${CARDS}/global`);
		assert.ok(global, 'the stylesheet the package publishes through exports is prepared');
		return 'four stylesheets compiled from SCSS, a Vue style block and a Svelte style block, plus the package sheet';
	});

	await step('packaging: the development runtime keeps the bundler it declares', async () => {
		const runtime = store.key('@beyond-js/local-2026');
		const item = prepared.inventory.items.find(({ id }) => id.startsWith(`module:${runtime}/`));
		assert.ok(item, 'the runtime is prepared');
		assert.equal(item.inputs.compiler.name, 'esbuild', 'a package that declares the packaging bundler is compiled by the selected compiler');
		return `${item.id} compiled by esbuild ${item.inputs.compiler.version}`;
	});

	await step('outputs: every item generated, with no diagnostic', async () => {
		const failed = [...prepared.units].filter(([, unit]) => unit.diagnostics.length);
		assert.deepEqual(failed.map(([id, unit]) => `${id}: ${JSON.stringify(unit.diagnostics)}`), []);
		return `${prepared.units.size} units`;
	});

	await step('production: the same application prepared for production, and written as files', async () => {
		const production = await Prepared.of(store, compiler, [ENTRY], { platform: 'browser', environment: 'production' }, 'esm');
		const errors = production.inventory.diagnostics.filter(({ severity }) => severity === 'error');
		assert.deepEqual(errors, [], errors.map(({ code, message }) => `${code}: ${message}`).join('\n'));

		const failed = [...production.units].filter(([, unit]) => unit.diagnostics.length);
		assert.deepEqual(failed.map(([id, unit]) => `${id}: ${JSON.stringify(unit.diagnostics)}`), []);

		// A production artifact of a composed module carries no source map and no update patch
		const widget = production.output(`module:${CARDS}/react`, 'js');
		assert.doesNotMatch(widget.code, /sourceMappingURL/, 'a production artifact carries no source map');

		const written = await production.write(process.argv[2]);
		delivered = written;
		return `${production.units.size} units, ${written.files} files in ${written.directory}`;
	});

	await step('consumption: a page of another origin loads the delivered application', async () => {
		origin = await new Delivered(delivered.directory, document({ imports: delivered.imports }, ENTRY)).start();
		browser = await new Browser().start();
		({ page, observed } = await browser.page());

		// A widget reports a failed render on the console, which is what names the cause of a family that does not appear
		page.on('console', message => reported.push(`${message.type()}: ${message.text().slice(0, 200)}`));

		await page.goto(`${origin.origin}/`, { waitUntil: 'load' });
		await page.waitForFunction(() => window.document.querySelector('card-html')?.shadowRoot?.querySelector('.card.html'), null, { timeout: 60000 });

		const outside = origin.requests.filter(path => path !== '/' && path !== '/favicon.ico');
		assert.ok(outside.length > 30, `${outside.length} files were asked of the origin`);
		assert.deepEqual(observed.refused.filter(one => !one.endsWith('/favicon.ico')), [], observed.refused.join('\n'));
		return `${outside.length} requests, all to the delivered origin, no development service`;
	});

	/**
	 * One step per family, so a family that does not work is named with what it did instead of hiding
	 * behind the ones that do
	 */
	for (const [element, selector, text, colour] of [
		['card-react', '.card.react', 'React', 'rgb(8, 145, 178)'],
		['card-vue', '.card.vue', 'Vue', 'rgb(22, 163, 74)'],
		['card-html', '.card.html', 'HTML', 'rgb(217, 119, 6)'],
		['card-svelte', '.card.svelte', 'Svelte', 'rgb(147, 51, 234)']
	]) {
		await step(`consumption, ${text}: the widget renders from the delivered outputs with its stylesheet`, async () => {
			const seen = await shown(page, element, selector);
			assert.ok(seen.found, `${element} rendered: ${JSON.stringify(seen)}\nthe page reported:\n  ${reported.join('\n  ')}`);
			assert.equal(seen.text, text, `${element} shows its label`);
			assert.equal(seen.color, colour, `${element} adopted its stylesheet`);
			return `${element} ${seen.color}`;
		});
	}

	await step('consumption: the page reports no error of its own', async () => {
		const errors = observed.errors.filter(one => !/favicon/.test(one));
		assert.deepEqual(errors, [], errors.join('\n'));
		return 'no page error';
	});
} finally {
	await page?.close().catch(() => void 0);
	origin?.stop();
	await browser?.stop();
	await rm(store.root, { recursive: true, force: true });
}

const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
