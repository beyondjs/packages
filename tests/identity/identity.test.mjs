/**
 * Identity: what a compilation generates tells its sources apart, and does not depend on where they were
 * extracted.
 *
 * The same package name, version and internal path can come from different sources, and one source can be
 * compiled in any directory. The identifiers that join the code of a component to its stylesheet — the
 * scope of a Vue component, the class of a Svelte one — must follow the identity of the source and not its
 * location, or a consumer that generates a module and its stylesheet in two units, each in a scratch
 * directory of its own, delivers a stylesheet that selects nothing; and they must distinguish components
 * at the same path in different packages or modules, or their styles apply to each other.
 *
 * ```sh
 * BEYOND_MODULES=/absolute/path/to/an/installation/node_modules \
 * BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core \
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/identity/identity.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { Browser } from '../preview/browser.mjs';
import { Prepared } from '../preparation/prepared.mjs';
import { Delivered, document } from '../preparation/consumer.mjs';
import { Sources, ORIGINS } from './support/sources.mjs';
import { Scopes } from './support/scopes.mjs';
import { Matrix } from './support/matrix.mjs';
import { colours } from './support/page.mjs';

const compiler = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const DEVELOPMENT = { platform: 'browser', environment: 'development' };
const PRODUCTION = { platform: 'browser', environment: 'production' };
const ENTRY = '@fixture/shell/entry';

// A module of the fixtures: the frameworks write classes of their own that scope nothing
const own = id => /:@fixture\//.test(id);

test('identity of compiled components', { timeout: 1_800_000 }, async t => {
	const sources = await new Sources().create();
	t.after(() => sources.remove());
	const relocated = await sources.relocate();
	t.after(() => relocated.remove());

	const { store } = sources;
	const SHELL = store.key('@fixture/shell');
	const KIT = sources.kits.get('npm');

	await t.test('every unit is byte-identical when its sources are extracted elsewhere and reached through a link', async () => {
		const matrix = new Matrix(compiler);
		const forms = id => (/:(@beyond-js|@fixture)\//.test(id) ? 'source' : 'npm');
		const entries = [ENTRY, '@fixture/shell/tw', '@fixture/cards/entry'];
		const roots = [store.root, relocated.root];
		for (const conditions of [DEVELOPMENT, PRODUCTION]) {
			await matrix.compare({ graph: sources.graph(), first: store.sources, second: relocated.sources, entries, conditions, roots, forms });
		}

		const missing = [...matrix.rows].filter(([, units]) => !units.length).map(([name]) => name);
		assert.deepEqual(missing, [], `processors no unit exercised: ${missing.join(', ')}`);
		t.diagnostic(`matrix: ${[...matrix.rows].map(([name, units]) => `${name} ${units.length}`).join('; ')}`);
	});

	const prepared = await Prepared.of({ graph: sources.graph(), sources: store.sources }, compiler, [ENTRY], DEVELOPMENT, 'esm', relocated);

	await t.test('a stylesheet generated on its own elsewhere selects the scopes its module writes', () => {
		const failed = [...prepared.units].filter(([, unit]) => unit.diagnostics.length);
		assert.deepEqual(failed.map(([id, unit]) => `${id}: ${JSON.stringify(unit.diagnostics)}`), []);

		const checked = [];
		for (const [id, unit] of prepared.units) {
			if (!id.startsWith('module:') || !own(id)) continue;
			const written = Scopes.unit(unit).js;
			const selected = Scopes.unit(prepared.units.get(id.replace(/^module:/, 'style:'))).css;
			if (!written.size && !selected.size) continue;
			assert.deepEqual([...selected].sort(), [...written].sort(), `${id}: the code writes ${[...written]} and the stylesheet generated on its own selects ${[...selected]}`);
			checked.push(id.replace(/^.*\//, ''));
		}
		assert.deepEqual(checked.sort(), ['panel', 'spanel', 'svelte', 'svelte', 'vue', 'vue']);
	});

	await t.test('components at the same path in other packages and modules have scopes of their own', () => {
		const scope = (key, subpath) => Scopes.single(prepared.units.get(`module:${key}/${subpath}`), `${key}/${subpath}`);
		const vue = [scope(SHELL, 'vue'), scope(SHELL, 'panel'), scope(KIT, 'vue')];
		const svelte = [scope(SHELL, 'svelte'), scope(SHELL, 'spanel'), scope(KIT, 'svelte')];
		assert.equal(new Set(vue).size, 3, `view.vue of the widget, of another module and of another package: ${vue}`);
		assert.equal(new Set(svelte).size, 3, `view.svelte of the widget, of another module and of another package: ${svelte}`);
	});

	await t.test('one name, version and path from npm, another host and two registries of one host has four identities', async () => {
		const found = { vue: new Map(), svelte: new Map(), keys: new Set() };
		for (const [name, key] of sources.kits) {
			const one = await Prepared.of({ graph: sources.graph(name), sources: store.sources }, compiler, ['@fixture/kit/vue', '@fixture/kit/svelte'], DEVELOPMENT, 'esm');
			for (const subpath of ['vue', 'svelte']) {
				const id = `module:${key}/${subpath}`;
				found[subpath].set(name, Scopes.single(one.units.get(id), id));
				found.keys.add(one.inventory.items.find(item => item.id === id).key);
			}
		}
		const count = Object.keys(ORIGINS).length;
		assert.equal(new Set(found.vue.values()).size, count, JSON.stringify([...found.vue]));
		assert.equal(new Set(found.svelte.values()).size, count, JSON.stringify([...found.svelte]));
		assert.equal(found.keys.size, count * 2, 'every output key names its origin');
	});

	await t.test('in a browser, the widget, a module of its package and a library keep their own colours', async s => {
		const delivered = await prepared.write();
		s.after(() => rm(delivered.directory, { recursive: true, force: true }));
		const origin = await new Delivered(delivered.directory, document({ imports: delivered.imports }, ENTRY)).start();
		s.after(() => origin.stop());
		const browser = await new Browser().start();
		s.after(() => browser.stop());

		const { page, observed } = await browser.page();
		await page.goto(`${origin.origin}/`, { waitUntil: 'load' });
		await page.waitForFunction(() => ['shell-vue', 'shell-svelte'].every(name => window.document.querySelector(name)?.shadowRoot?.querySelector('.title.panel')), null, { timeout: 60000 });
		assert.deepEqual(observed.errors, []);

		const expected = { shell: 'rgb(200, 0, 0)', kit: 'rgb(0, 128, 0)', panel: 'rgb(0, 0, 200)' };
		assert.deepEqual(await colours(page, 'shell-vue'), expected, 'Vue');
		assert.deepEqual(await colours(page, 'shell-svelte'), expected, 'Svelte');
	});
});
