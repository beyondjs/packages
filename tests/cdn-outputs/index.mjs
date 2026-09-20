/**
 * Validation of `@beyond-js/packages/generation`: one public module per unit, code, stylesheets, maps and
 * static files with their relations and provenance, the `esm` and `system` formats executed, ordinary npm
 * interop, both publication forms and the compatibility key. Read the local README.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Generation } from '@beyond-js/packages/generation';
import { Report, Store, Selected, Prepared, Consumer } from './harness.mjs';
import { SystemLoader } from './system.mjs';
import { Forms } from './forms.mjs';
import { Keys } from './keys.mjs';
import { RealReact } from './react.mjs';
import { Delivered } from './delivery.mjs';
import { Reproducible } from './reproducible.mjs';

const report = new Report();
const compiler = Selected.compiler;
const store = await new Store().create();
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-outputs-')));
const UI = 'npm:@fixture/ui@2.0.0';
const unit = (item, conditions, format = 'esm', extra = {}) => Generation.unit(Object.assign({ item, graph: store.graph, sources: store.sources, conditions, format, compiler }, extra));
const output = (generated, kind, of) => generated.outputs.find(one => one.kind === kind && (!of || one.relations.of === of));
const codes = list => list.map(({ code }) => code);
const browser = { platform: 'browser', environment: 'development' };
const node = { platform: 'node', environment: 'development' };

try {
	await report.step('unit: one public module yields code, stylesheet and maps; bare references kept, style references related', async () => {
		const widget = await unit({ kind: 'module', package: UI, subpath: 'widget' }, browser);
		assert.deepEqual(widget.diagnostics, []);
		assert.deepEqual(widget.outputs.map(({ kind, media, relations }) => `${kind} ${media} ${relations.of ?? ''}`.trim()), [
			'js text/javascript', 'map application/json js', 'css text/css', 'map application/json css'
		]);
		for (const one of widget.outputs) assert.ok(/^sha256-/.test(one.digest) && /^sha256-[0-9a-f]{64}$/.test(one.key) && one.size > 0);
		assert.ok(!output(widget, 'js').code.includes('.widget {'), 'Styles are not injected into the code');
		assert.equal(output(widget, 'js').relations.stylesheet, true);
		assert.deepEqual(JSON.parse(output(widget, 'map', 'js').code).sources.sort(), ['beyond://@fixture/ui@2.0.0/widget/index.ts', 'beyond://@fixture/ui@2.0.0/widget/label.ts']);
		assert.deepEqual(JSON.parse(output(widget, 'map', 'css').code).sources, ['beyond://@fixture/ui@2.0.0/widget/widget.css']);

		const main = await unit({ kind: 'module', package: 'npm:@fixture/app@1.0.0', subpath: 'main' }, browser);
		const { code, relations } = output(main, 'js');
		for (const bare of ['@fixture/ui/widget', '@fixture/ui/chart', 'fake-react', 'fake-react-dom']) assert.ok(code.includes(`"${bare}"`), `${bare} stays bare`);
		assert.ok(!code.includes('WIDGET_SOURCE_MARKER') && !code.includes('Invalid hook call'), 'No other public module is inlined');
		assert.ok(!code.includes('@fixture/ui/theme'), 'A stylesheet reference is not an import of the code');
		assert.deepEqual(relations.references.find(({ kind }) => kind === 'style'), { specifier: '@fixture/ui/theme', kind: 'style', package: UI, subpath: 'theme', builtin: undefined });
		assert.equal(main.provenance.inputs.compiler.name, 'esbuild');
		assert.equal(main.provenance.inputs.resolution['fake-react'], 'npm:fake-react@18.0.0');
		return `compiler ${main.provenance.compiler.version}, ${widget.outputs.length} outputs for ./widget in ${widget.provenance.ms} ms`;
	});

	await report.step('unit: CSS url() references address /assets/ and are related; logo, font and style module are their own units', async () => {
		const widget = await unit({ kind: 'module', package: UI, subpath: 'widget' }, browser);
		const css = output(widget, 'css');
		assert.ok(css.code.includes('url(../assets/widget/logo.svg)') && css.code.includes('url(../assets/widget/fonts/fixture.woff2)'), css.code);
		assert.deepEqual(css.relations.assets, [{ package: UI, path: 'widget/fonts/fixture.woff2' }, { package: UI, path: 'widget/logo.svg' }]);

		const owned = await unit({ kind: 'style', package: UI, subpath: 'widget' }, browser);
		assert.deepEqual(owned.outputs.map(({ kind }) => kind), ['css', 'map']);
		assert.equal(output(owned, 'css').digest, css.digest);

		const logo = await unit({ kind: 'asset', package: UI, subpath: 'widget/logo.svg' }, browser);
		assert.deepEqual([logo.outputs[0].kind, logo.outputs[0].media], ['asset', 'image/svg+xml']);
		assert.deepEqual(Buffer.from(logo.outputs[0].bytes), await readFile(store.file('ui/widget/logo.svg')));
		const font = await unit({ kind: 'asset', package: UI, subpath: 'widget/fonts/fixture.woff2' }, browser);
		assert.equal(font.outputs[0].media, 'font/woff2');

		const theme = await unit({ kind: 'style', package: UI, subpath: 'theme' }, browser);
		assert.deepEqual(theme.outputs.map(({ kind }) => kind), ['css', 'map']);
		assert.ok(output(theme, 'css').code.includes('--fixture-accent'));
		assert.deepEqual(codes((await unit({ kind: 'asset', package: UI, subpath: '../app/package.json' }, browser)).diagnostics), ['ASSET_OUTSIDE_PACKAGE']);
		return 'stylesheet → ../assets/<path in package>; svg, woff2 and style module generated separately';
	});

	await report.step('esm (node): every unit of the inventory executes under Node through an import map, sharing one library', async () => {
		const prepared = await Prepared.of(store, compiler, ['@fixture/app/main'], node, 'esm');
		assert.deepEqual(prepared.diagnostics, []);
		const result = await Consumer.run('fixture', await prepared.write(join(scratch, 'esm')), scratch);
		assert.deepEqual(result, { view: 'state:widget', chart: 'chart of widget', mode: 'development', named: 'function', shared: true, defaulted: true });
		return `${prepared.code.size} modules executed: ${JSON.stringify(result)}`;
	});

	await report.step('system: System.register outputs keep bare named dependencies and execute in a minimal loader', async () => {
		const system = await Prepared.of(store, compiler, ['@fixture/app/main'], node, 'system');
		assert.deepEqual(system.diagnostics, []);
		const main = system.code.get('@fixture/app/main');
		assert.match(main, /^System\.register\(\["@fixture\/ui\/widget", "fake-react", "fake-react-dom"\]/);
		assert.ok(main.includes('context_1.import("@fixture/ui/chart")'), 'A dynamic import goes through the loader');
		assert.equal(system.units.get('module:npm:@fixture/app@1.0.0/main').provenance.compiler.system.transform, 'typescript');

		const map = JSON.parse(system.units.get(`module:${UI}/widget`).outputs.find(({ kind }) => kind === 'map').code);
		assert.deepEqual(map.sources.sort(), ['beyond://@fixture/ui@2.0.0/widget/index.ts', 'beyond://@fixture/ui@2.0.0/widget/label.ts'], 'The composed map still names the original sources');
		assert.ok(map.sourcesContent.some(content => content.includes('WIDGET_SOURCE_MARKER')), 'and keeps their content');

		const loader = new SystemLoader(system.code);
		const app = await loader.import('@fixture/app/main');
		const react = await loader.import('fake-react');
		assert.equal(app.view(), 'state:widget');
		assert.equal((await app.chart()).chart(), 'chart of widget');
		assert.equal((await loader.import('fake-react-dom')).react, react.default);
		assert.deepEqual([...loader.evaluations.values()], new Array(loader.evaluations.size).fill(1), 'Each public module is evaluated once');
		return `${loader.evaluations.size} System modules, each evaluated once`;
	});

	await report.step('npm: CommonJS interop, exports conditions and NODE_ENV per unit; the renderer imports the same library module', async () => {
		const react = { kind: 'module', package: 'npm:fake-react@18.0.0', subpath: '.' };
		const development = output(await unit(react, node), 'js').code;
		const production = output(await unit(react, { platform: 'node', environment: 'production' }), 'js').code;
		assert.ok(development.includes('development') && !development.includes(`'production'`) && !development.includes('"production"'));
		assert.ok(production.includes('"production"') && !production.includes('development'), 'Only the selected NODE_ENV branch is compiled');
		assert.ok(!development.includes('react-server') && !development.includes('must not be selected'));
		assert.match(development, /export \{[^}]*createElement[^}]*useState/s);

		const runtime = { kind: 'module', package: 'npm:fake-react@18.0.0', subpath: 'jsx-runtime' };
		assert.ok(output(await unit(runtime, browser), 'js').code.includes('"browser"'));
		assert.ok(output(await unit(runtime, node), 'js').code.includes('"default"'));

		const renderer = await unit({ kind: 'module', package: 'npm:fake-react-dom@18.0.0', subpath: '.' }, node);
		const { code, relations } = output(renderer, 'js');
		assert.match(code, /import \* as \w+ from "fake-react"/);
		assert.ok(!code.includes('Invalid hook call') && !/__require\(["']/.test(code), 'The library is referenced, never inlined or required dynamically');
		assert.deepEqual(relations.references, [{ specifier: 'fake-react', kind: 'eager', package: 'npm:fake-react@18.0.0', subpath: '.', builtin: undefined }]);

		const client = output(await unit({ kind: 'module', package: 'npm:fake-react-dom@18.0.0', subpath: 'client' }, node), 'js').code;
		assert.match(client, /from "fake-react-dom"/);
		assert.ok(!client.includes('dispatcher'), 'A subpath does not carry a copy of the root module of its package');
		return 'named + default exports, browser/default conditions, dead NODE_ENV branch removed, peer kept bare';
	});

	await report.step('diagnostics: build errors and unsupported npm shapes are always returned, with no output', async () => {
		await store.write('ui', 'extra/index.ts', `export const extra = ;\n`);
		const broken = await unit({ kind: 'module', package: UI, subpath: 'extra' }, browser);
		await store.write('ui', 'extra/index.ts', `export const extra = 'declared';\n`);
		assert.deepEqual(codes(broken.diagnostics), ['BUNDLE_ERROR']);
		assert.match(broken.diagnostics[0].message, /^index\.ts \(1:\d+\): /);
		assert.deepEqual(broken.outputs, []);

		const react = 'npm:fake-react@18.0.0';
		assert.deepEqual(codes((await unit({ kind: 'module', package: react, subpath: 'internals' }, browser)).diagnostics), ['EXPORT_NOT_FOUND']);
		assert.deepEqual(codes((await unit({ kind: 'module', package: react, subpath: '.' }, browser, 'cjs')).diagnostics), ['FORMAT_UNSUPPORTED']);
		assert.deepEqual(codes((await unit({ kind: 'module', package: react, subpath: '.' }, browser, 'esm', { compiler: void 0 })).diagnostics), ['COMPILER_NOT_SELECTED']);
		assert.deepEqual(codes((await unit({ kind: 'module', package: 'npm:absent@1.0.0', subpath: '.' }, browser)).diagnostics), ['PACKAGE_NOT_PINNED']);
		return 'BUNDLE_ERROR with file and position, EXPORT_NOT_FOUND, FORMAT_UNSUPPORTED, COMPILER_NOT_SELECTED, PACKAGE_NOT_PINNED';
	});

	await new Forms(report, store, compiler, scratch).run();
	await new Keys(report, store, compiler).run();
	await new Reproducible(report, compiler).check('the fixture application (sources, style module, static files, adapted CommonJS)', store, ['@fixture/app/main', 'fake-react-dom/client', 'fake-react/jsx-runtime']);
	await new RealReact(report, compiler, scratch).run();
	await new Delivered(report, compiler).run();
} finally {
	await store.destroy();
	await rm(scratch, { recursive: true, force: true });
}

process.exit(report.close());
