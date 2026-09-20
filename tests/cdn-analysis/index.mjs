/**
 * Validation of `@beyond-js/packages/publication` and `@beyond-js/packages/analysis`: the publication
 * discriminator, the resolution of ordinary npm `exports`, and the inventory traced from application
 * entries over a pinned graph, inspected before any output exists. Read the local README.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Publication, Exports } from '@beyond-js/packages/publication';
import { Analysis, Compatibility } from '@beyond-js/packages/analysis';
import { Report } from './harness.mjs';
import { Store, Selected } from './store.mjs';
import { Agreement } from './agreement.mjs';

const report = new Report();
const compiler = Selected.compiler;
const store = await new Store().create();
const browser = { platform: 'browser', environment: 'development' };
const trace = (extra = {}) => Analysis.trace(Object.assign({ graph: store.graph, sources: store.sources, entries: ['@fixture/app/main'], conditions: browser, compiler }, extra));
const ids = inventory => inventory.items.map(({ id }) => id);
const item = (inventory, id) => inventory.items.find(one => one.id === id);
const codes = list => list.map(({ code }) => code);
const UI = 'npm:@fixture/ui@2.0.0';
const APP = 'npm:@fixture/app@1.0.0';

try {
	await report.step('publication: the manifest field selects source, distribution or npm; anything else is a diagnostic', () => {
		const read = publication => Publication.read({ name: 'x', version: '1.0.0', beyond: publication === void 0 ? void 0 : { publication } });
		const protocol = 'beyond-publication/1';

		assert.deepEqual(read(void 0), { form: 'npm', version: '1.0.0', diagnostics: [] });
		assert.equal(read({ protocol, form: 'source', modules: 'modules' }).modules, 'modules');
		assert.equal(read({ protocol, form: 'source' }).form, 'source');
		const compiled = { compiler: { name: 'esbuild', version: '0.25.9' }, formats: ['esm', 'system'] };
		const distribution = read({ protocol, form: 'distribution', ...compiled });
		assert.equal(distribution.form, 'distribution');
		assert.equal(distribution.manifest, './beyond-distribution.json', 'The layout fixes where the distribution manifest is');

		const refused = {
			PUBLICATION_PROTOCOL_UNKNOWN: read({ protocol: 'beyond-publication/9', form: 'source' }),
			PUBLICATION_PROTOCOL_MISSING: read({ form: 'source' }),
			PUBLICATION_FORM_INVALID: read({ protocol, form: 'binary' }),
			PUBLICATION_AMBIGUOUS: read({ protocol, form: 'source', ...compiled }),
			PUBLICATION_COMPILER_INVALID: read({ protocol, form: 'distribution', formats: ['esm'] }),
			PUBLICATION_FORMATS_INVALID: read({ protocol, form: 'distribution', compiler: compiled.compiler, formats: ['cjs'] }),
			PUBLICATION_MEMBER_UNKNOWN: read({ protocol, form: 'source', layout: 'dist' }),
			PUBLICATION_INVALID: read('source'),
			MANIFEST_INVALID: Publication.read(null),
			PACKAGE_VERSION_MISSING: Publication.read({ name: 'x' }),
			PACKAGE_NAME_MISSING: Publication.read({ version: '1.0.0' })
		};
		for (const [code, result] of Object.entries(refused)) {
			assert.deepEqual(codes(result.diagnostics), [code]);
			assert.equal(result.form, undefined, `${code} selects no form`);
		}
		// Built files beside sources change nothing: the layout is never the discriminator
		assert.equal(Publication.read({ name: 'x', version: '1.0.0', main: 'dist/index.js', files: ['dist', 'src'] }).form, 'npm');
		return `3 forms, ${Object.keys(refused).length} refusals`;
	});

	await report.step('npm exports: conditions resolve in package order, per platform and environment, with actionable refusals', () => {
		const exports = new Exports({
			name: 'pkg', main: './legacy.js',
			exports: {
				'.': { 'react-server': './server.js', browser: { development: './browser.dev.js', default: './browser.js' }, node: './node.js', default: './index.js' },
				'./feature': { require: './feature.cjs' }, './icons/*': './dist/icons/*.js', './internal/*': null, './types': { types: './index.d.ts' }
			}
		});
		assert.equal(exports.resolve('.', 'browser', 'development').target, './browser.dev.js');
		assert.deepEqual(exports.resolve('.', 'browser', 'development').via, ['browser', 'development']);
		assert.equal(exports.resolve('.', 'browser', 'production').target, './browser.js');
		assert.equal(exports.resolve('.', 'node', 'production').target, './node.js');
		assert.equal(exports.resolve('./feature', 'browser').target, './feature.cjs', 'A require-only target is still consumable');
		assert.equal(exports.resolve('./icons/add', 'browser').target, './dist/icons/add.js');
		assert.deepEqual(codes(exports.resolve('./internal/x', 'browser').diagnostics), ['EXPORT_NOT_FOUND']);
		assert.deepEqual(codes(exports.resolve('./missing', 'browser').diagnostics), ['EXPORT_NOT_FOUND']);
		assert.deepEqual(codes(exports.resolve('./types', 'browser').diagnostics), ['EXPORT_CONDITIONS_UNMATCHED']);
		assert.deepEqual(exports.subpaths, ['.', './feature', './types']);

		const legacy = new Exports({ name: 'old', main: 'lib/main.js', module: 'lib/main.esm.js', browser: 'lib/main.browser.js' });
		assert.equal(legacy.resolve('.', 'browser').target, './lib/main.browser.js');
		assert.equal(legacy.resolve('.', 'node').target, './lib/main.esm.js');
		assert.equal(legacy.resolve('./lib/util', 'node').target, './lib/util');
		return 'nested conditions, patterns, null exclusions, require-only, legacy fields';
	});

	let inventory;
	await report.step('trace: reachable public modules across packages, eager and lazy, without the unreachable ones', async () => {
		const before = await store.listing();
		const measured = await Analysis.measured({ graph: store.graph, sources: store.sources, entries: ['@fixture/app/main'], conditions: browser, compiler });
		inventory = measured.inventory;
		assert.deepEqual(await store.listing(), before, 'Tracing writes nothing into the store');
		assert.equal(inventory.protocol, 'beyond-inventory/1');
		assert.equal(inventory.graph, store.graph.digest);
		assert.deepEqual(inventory.entries, [{ target: 'web', package: APP, subpath: 'main' }]);

		const modules = inventory.items.filter(({ kind }) => kind === 'module');
		assert.deepEqual(modules.map(({ id, loading }) => `${id} ${loading}`), [
			`module:${APP}/main eager`,
			`module:${UI}/chart lazy`,
			`module:${UI}/widget eager`,
			'module:npm:fake-react-dom@18.0.0/. eager',
			'module:npm:fake-react@18.0.0/. eager'
		]);
		for (const absent of ['unused', 'admin', 'extra']) assert.ok(!ids(inventory).some(id => id.endsWith(`/${absent}`)), `${absent} is not reachable`);
		assert.ok(inventory.items.every(({ targets }) => targets.join() === 'web'));

		// A lazy module that statically imports an eager one does not make it lazy, and both reference it
		assert.deepEqual(item(inventory, `module:${UI}/widget`).importers, [`module:${APP}/main`, `module:${UI}/chart`]);
		assert.deepEqual(item(inventory, 'module:npm:fake-react@18.0.0/.').importers, [`module:${APP}/main`, 'module:npm:fake-react-dom@18.0.0/.']);
		return `${modules.length} modules in ${measured.cost.ms} ms (${measured.cost.compiled} compiled in memory), compiler ${measured.compiler.version}`;
	});

	await report.step('trace: style modules, module stylesheets, the declared logo and font, and CSS url() references are items', () => {
		const theme = item(inventory, `style:${UI}/theme`);
		assert.deepEqual([theme.kind, theme.loading, theme.media, theme.inputs.output], ['style', 'eager', 'text/css', 'css']);
		assert.deepEqual(theme.importers, [`module:${APP}/main`]);

		const owned = item(inventory, `style:${UI}/widget`);
		assert.deepEqual(owned.importers, [`module:${UI}/widget`]);
		assert.equal(owned.inputs.output, 'css');
		assert.notEqual(owned.key, item(inventory, `module:${UI}/widget`).key);

		const logo = item(inventory, `asset:${UI}/widget/logo.svg`);
		assert.deepEqual([logo.kind, logo.subpath, logo.declared, logo.media, logo.loading], ['asset', 'widget/logo.svg', true, 'image/svg+xml', 'eager']);
		assert.deepEqual(logo.importers, [`module:${UI}/widget`, `style:${UI}/widget`]);
		assert.deepEqual([logo.inputs.format, logo.inputs.output, logo.inputs.conditions], ['none', 'asset', []]);
		assert.equal(item(inventory, `asset:${UI}/widget/fonts/fixture.woff2`).media, 'font/woff2');
		return 'style module, owned stylesheet, logo (image/svg+xml), font (font/woff2)';
	});

	await report.step('trace: an indeterminate dynamic import is unknown[] and DYNAMIC_IMPORT_UNKNOWN, unless it is declared', async () => {
		assert.deepEqual(inventory.diagnostics.map(({ code, severity }) => `${code} ${severity}`), ['DYNAMIC_IMPORT_UNKNOWN error']);
		assert.equal(inventory.unknown.length, 1);
		const [unknown] = inventory.unknown;
		assert.deepEqual([unknown.importer, unknown.declared, unknown.code], [`module:${APP}/main`, false, 'DYNAMIC_IMPORT_UNKNOWN']);
		assert.match(unknown.expression, /@fixture\/plugins\//);
		assert.deepEqual([unknown.location.file, unknown.location.line], ['index.ts', 7]);

		const declared = await trace({ declared: { '@fixture/app/main': ['@fixture/ui/extra'] } });
		assert.deepEqual(declared.diagnostics, []);
		assert.deepEqual(declared.unknown.map(({ declared, code }) => [declared, code]), [[true, 'DYNAMIC_IMPORT_DECLARED']]);
		const extra = item(declared, `module:${UI}/extra`);
		assert.deepEqual([extra.loading, extra.declared], ['lazy', true]);
		assert.equal(item(declared, `module:${APP}/main`).key, item(inventory, `module:${APP}/main`).key, 'A declaration adds items, not inputs');
		return `${unknown.location.file}:${unknown.location.line}; declared → extra lazy`;
	});

	await report.step('trace: the inventory carries no compiled code; every key is the digest of its inputs, which change with what matters', async () => {
		const text = JSON.stringify(inventory);
		for (const marker of ['APP_MAIN_SOURCE_MARKER', 'WIDGET_SOURCE_MARKER', '--fixture-accent']) assert.ok(!text.includes(marker), `${marker} is not in the inventory`);

		for (const { id, inputs, key } of inventory.items) assert.equal(key, Compatibility.key(inputs), id);
		const main = item(inventory, `module:${APP}/main`);
		assert.deepEqual(main.inputs.resolution, { '@fixture/ui': UI, 'fake-react': 'npm:fake-react@18.0.0', 'fake-react-dom': 'npm:fake-react-dom@18.0.0' });
		assert.deepEqual(main.inputs.sources, [store.graph.nodes[APP].integrity]);
		assert.deepEqual([main.inputs.module, main.inputs.format, main.inputs.output, main.inputs.compiler.name], [`${APP}/main`, 'esm', 'js', 'esbuild']);
		assert.throws(() => Compatibility.key(Object.assign({ scope: 'org:42' }, main.inputs)), /storage scope/);

		const key = async extra => item(await trace(extra), `module:${APP}/main`).key;
		assert.notEqual(await key({ format: 'system' }), main.key);
		assert.notEqual(await key({ conditions: { platform: 'browser', environment: 'production' } }), main.key);
		assert.notEqual(await key({ conditions: { platform: 'node', environment: 'development' } }), main.key);
		assert.equal(await key({ sources: Object.fromEntries(Object.entries(store.sources).map(([node, extracted]) => [node, { extracted }])) }), main.key);
		return `${Buffer.byteLength(text)} bytes of JSON for ${inventory.items.length} items`;
	});

	await report.step('trace: ordinary npm packages trace per subpath and condition, with peers followed in their context', async () => {
		const client = await trace({ entries: [{ specifier: 'fake-react-dom/client', target: 'backend' }, 'fake-react/jsx-runtime'], conditions: { platform: 'node', environment: 'production' } });
		assert.deepEqual(client.diagnostics, []);
		assert.deepEqual(ids(client), ['module:npm:fake-react-dom@18.0.0/.', 'module:npm:fake-react-dom@18.0.0/client', 'module:npm:fake-react@18.0.0/.', 'module:npm:fake-react@18.0.0/jsx-runtime']);
		assert.deepEqual(item(client, 'module:npm:fake-react-dom@18.0.0/.').inputs.conditions, ['default', 'import', 'module', 'node', 'production']);

		// Two applications bind the peer of one renderer to different libraries: each context follows its own
		const graph = store.graph;
		graph.nodes['npm:fake-react@18.1.0'] = Store.node('fake-react', '18.1.0');
		graph.nodes['npm:@fixture/other@1.0.0'] = Store.node('@fixture/other', '1.0.0');
		graph.edges.push(Store.edge('npm:fake-react-dom@18.0.0', 'npm:fake-react@18.1.0', 'peer', 'npm:@fixture/other@1.0.0'));
		const sources = Object.assign({}, store.sources, { 'npm:fake-react@18.1.0': store.file('fake-react') });
		const contextual = await trace({ graph: Store.seal(graph), sources });
		assert.equal(item(contextual, 'module:npm:fake-react-dom@18.0.0/.').inputs.resolution['fake-react'], 'npm:fake-react@18.0.0');
		const orphan = await trace({ graph, sources, entries: ['fake-react-dom'] });
		assert.ok(codes(orphan.diagnostics).includes('PEER_CONTEXT_AMBIGUOUS'));
		return 'renderer, client and library are separate items; peer bound by context, ambiguous without one';
	});

	await report.step('trace: a distribution is read from its manifest and never compiled', async () => {
		const digest = content => `sha256-${createHash('sha256').update(content).digest('base64')}`;
		const file = (kind, name, content, media) => ({ kind, file: name, media, digest: digest(content), bytes: Buffer.byteLength(content) });
		const js = 'export const Widget = { label: "distributed" };\n';
		const css = '.widget { background: url(../assets/widget/logo.svg); }\n';
		const logo = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';
		const variant = { conditions: { platform: 'browser' }, format: 'esm', outputs: [file('js', 'dist/widget.js', js, 'text/javascript'), file('css', 'dist/widget.css', css, 'text/css')] };
		const manifest = {
			protocol: 'beyond-distribution/1', package: { name: '@fixture/ui', version: '2.0.0' },
			modules: {
				'./widget': { kind: 'module', references: [], assets: ['widget/logo.svg'], variants: [variant] },
				'./chart': { kind: 'module', references: [{ specifier: '@fixture/ui/widget', kind: 'eager' }], assets: [], variants: [] },
				'./theme': { kind: 'style', references: [], assets: [], variants: [] },
				'./unused': { kind: 'module', references: [], assets: [], variants: [] }
			},
			assets: { 'widget/logo.svg': { file: 'widget/logo.svg', media: 'image/svg+xml', digest: digest(logo), bytes: Buffer.byteLength(logo) } }
		};
		const publication = { protocol: 'beyond-publication/1', form: 'distribution', compiler: { name: 'fixture-compiler', version: '3.2.1' }, formats: ['esm'] };
		await store.add(UI, '@fixture/ui', '2.0.0', 'ui-distribution', {
			'package.json': JSON.stringify({ name: '@fixture/ui', version: '2.0.0', beyond: { publication } }),
			'beyond-distribution.json': JSON.stringify(manifest), 'dist/widget.js': js, 'dist/widget.css': css, 'widget/logo.svg': logo
		});

		const { inventory: distributed, cost } = await Analysis.measured({ graph: store.graph, sources: store.sources, entries: ['@fixture/app/main'], conditions: browser, compiler });
		await store.add(UI, '@fixture/ui', '2.0.0', 'ui');
		assert.deepEqual(codes(distributed.diagnostics), ['DYNAMIC_IMPORT_UNKNOWN']);
		assert.deepEqual([cost.read, cost.compiled], [3, 3], 'widget, chart and theme are read; the application and the two npm packages are compiled in memory');
		const widget = item(distributed, `module:${UI}/widget`);
		assert.deepEqual([widget.inputs.compiler.name, widget.inputs.compiler.version], ['fixture-compiler', '3.2.1']);
		assert.ok(item(distributed, `style:${UI}/widget`) && item(distributed, `asset:${UI}/widget/logo.svg`));
		assert.ok(!ids(distributed).includes(`module:${UI}/unused`));
		return `${cost.read} modules read, ${cost.compiled} compiled`;
	});

	await report.step('trace (negative): missing sources, an unpinned dependency, no compiler and no entries are diagnostics', async () => {
		const { [UI]: removed, ...partial } = store.sources;
		assert.ok(codes((await trace({ sources: partial })).diagnostics).includes('SOURCES_MISSING'));

		const graph = store.graph;
		delete graph.nodes['npm:fake-react@18.0.0'];
		graph.edges = graph.edges.filter(({ to }) => to !== 'npm:fake-react@18.0.0');
		assert.ok(codes((await trace({ graph })).diagnostics).includes('DEPENDENCY_UNRESOLVED'));

		const unverified = store.graph;
		unverified.nodes[UI].integrity = null;
		assert.ok(codes((await trace({ graph: unverified })).diagnostics).includes('INTEGRITY_MISSING'));
		const fetched = Object.assign({}, store.sources, { [UI]: { extracted: store.sources[UI], integrity: 'sha512-ZmV0Y2hlZA==' } });
		assert.deepEqual(item(await trace({ graph: unverified, sources: fetched }), `module:${UI}/widget`).inputs.sources, ['sha512-ZmV0Y2hlZA==']);

		assert.deepEqual(codes((await trace({ compiler: void 0 })).diagnostics), ['COMPILER_NOT_SELECTED']);
		assert.deepEqual(codes((await trace({ entries: [] })).diagnostics), ['ENTRIES_MISSING']);
		assert.deepEqual(codes((await trace({ format: 'cjs' })).diagnostics), ['FORMAT_UNSUPPORTED']);
		assert.deepEqual(codes((await trace({ entries: ['@fixture/absent/main'] })).diagnostics), ['ENTRY_UNRESOLVED']);
		assert.deepEqual(codes((await trace({ entries: ['@fixture/ui/absent'] })).diagnostics), ['MODULE_NOT_FOUND']);
		assert.deepEqual(codes((await trace({ graph: { protocol: 'other/1' } })).diagnostics), ['GRAPH_PROTOCOL_UNKNOWN']);
		return 'SOURCES_MISSING, DEPENDENCY_UNRESOLVED, INTEGRITY_MISSING, COMPILER_NOT_SELECTED, ENTRIES_MISSING, FORMAT_UNSUPPORTED, ENTRY_UNRESOLVED, MODULE_NOT_FOUND, GRAPH_PROTOCOL_UNKNOWN';
	});

	await new Agreement(report, store, trace).run();
} finally {
	await store.destroy();
}

process.exit(report.close());
