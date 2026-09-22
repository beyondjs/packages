/**
 * Styles and SDK validation: what the TypeScript bundler produces from a module with CSS, SCSS, Tailwind,
 * Vue and Svelte sources, a widget declaration and per-conditional entries, and how watched edits of
 * sources, partials, a shared theme and Tailwind candidates invalidate exactly the affected module.
 *
 * It runs on a temporary copy of `fixture/` under BEE Node against the bootstrap Engine, with the real
 * watchers service. Nothing here executes the artifacts in a browser: that is the web acceptance.
 *
 * ```sh
 * BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/styles-sdk/index.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';
import { WatchersService } from '@beyond-js/packages/watchers';
import { once, results, step } from '../stage-1/harness.mjs';

const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const here = dirname(fileURLToPath(import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-styles-sdk-')));
await cp(join(here, 'fixture'), root, { recursive: true });
const file = (...parts) => join(root, 'ui', ...parts);

const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
const workspace = new Workspace(root, { watcher: true });
const out = join(root, '.artifacts');
const web = new Artifacts(workspace, { path: out, conditions: { platform: 'web' } });
const node = new Artifacts(workspace, { path: out, conditions: { platform: 'node' } });
const types = new Artifacts(workspace, { path: out, conditions: { platform: 'types' } });

const conditional = (subpath, key = 'web') => workspace.packages.get('ui').modules.get(subpath).conditionals.get(key);
const read = relative => readFile(join(out, relative), 'utf8');
/**
 * Edits sources and waits until the watched compilation reflects them: the predicate reads the state of
 * the conditional, so a stale change event never counts as the rebuild
 */
const rebuild = async (dp, edit, until, artifacts = web) => {
	const change = once(dp, 'change');
	await edit();
	for (const deadline = Date.now() + 20000; !until(); ) {
		if (Date.now() > deadline) throw new Error(`The compilation did not reflect the edit in 20 s: valid=${dp.valid}, errors=${JSON.stringify(dp.errors)}`);
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	await Promise.race([change, Promise.resolve()]);
	return artifacts.build();
};

let report;
try {
	await step('watchers service and discovery: the fixture declares its modules and nothing else', async () => {
		await service.start();
		await workspace.ready;
		const ui = workspace.packages.get('ui');
		await ui.ready;
		await ui.modules.ready;
		assert.deepEqual(ui.modules.errors, []);
		assert.deepEqual([...ui.modules.keys()].sort(), ['./badge', './broken', './card', './global', './render', './svelte-view', './vue-view', './widget']);
		return [...ui.modules.keys()].sort().join(', ');
	});

	await step('web build: every module builds and the stylesheets are written beside the artifacts', async () => {
		report = await web.build();
		const errors = report.errors.map(({ code, message }) => `${code}: ${message}`);
		assert.deepEqual(errors, [], errors.join('\n'));
		const named = Object.fromEntries(report.artifacts.map(artifact => [artifact.specifier, artifact]));
		assert.deepEqual(Object.keys(named).sort(), ['@fixture/shared/palette', '@fixture/ui/badge', '@fixture/ui/broken', '@fixture/ui/card', '@fixture/ui/global', '@fixture/ui/render', '@fixture/ui/svelte-view', '@fixture/ui/vue-view', '@fixture/ui/widget']);
		for (const specifier of ['@fixture/ui/card', '@fixture/ui/badge', '@fixture/ui/vue-view', '@fixture/ui/svelte-view', '@fixture/ui/widget', '@fixture/ui/global']) {
			assert.ok(named[specifier].styles, `${specifier} has a stylesheet`);
			assert.ok(existsSync(join(out, named[specifier].styles)), `${specifier} stylesheet written`);
		}
		assert.equal(named['@fixture/ui/render'].styles, void 0);
		return `${report.artifacts.length} artifacts`;
	});

	await step('scss: the module stylesheet compiles its SCSS with its partial and concatenates its CSS, with a map', async () => {
		const card = report.artifacts.find(one => one.specifier === '@fixture/ui/card');
		const css = await read(card.styles);
		assert.match(css, /\.card\s*\{[^}]*color:\s*rgb\(12, 74, 110\)/);
		assert.match(css, /\.card-extra\s*\{\s*display:\s*block/);
		assert.ok(css.indexOf('.card-extra') < css.indexOf('.card {'), 'outputs follow file order: extra.css before styles.scss');
		const map = JSON.parse(await read(`${card.styles}.map`));
		assert.ok(map.sources.some(source => source.endsWith('styles.scss')), JSON.stringify(map.sources));
		const code = await read(card.file);
		assert.match(code, /new __Bundle\(\{"module":\{"vspecifier":"@fixture\/ui@0\.1\.0\/card"\},"type":"ts","styles":true\}/);
		return 'partial resolved, two sources concatenated in order, map names styles.scss';
	});

	await step('tailwind: only the declared sources are scanned, the theme import is followed and the utilities of the candidates are emitted', async () => {
		const badge = report.artifacts.find(one => one.specifier === '@fixture/ui/badge');
		const css = await read(badge.styles);
		assert.match(css, /\.p-4\s*\{/);
		assert.match(css, /\.text-brand\s*\{/);
		assert.match(css, /--fixture-brand:\s*rgb\(200, 30, 30\)/, 'the theme file outside the module was inlined');
		assert.match(css, /\.badge\s*\{/);
		assert.doesNotMatch(css, /\.hidden\s*\{/);
		const processor = conditional('./badge').processors.get('styles');
		assert.ok(processor.dependencies.some(dependency => dependency.endsWith('theme/tokens.css')), JSON.stringify(processor.dependencies));
		assert.ok(processor.dependencies.some(dependency => dependency.endsWith('badge/view.ts')), 'the scanned source is a dependency');
		return `${processor.dependencies.length} discovered dependencies watched`;
	});

	await step('vue: the component becomes script, render and facade internal modules, and its style blocks the stylesheet', async () => {
		const vue = report.artifacts.find(one => one.specifier === '@fixture/ui/vue-view');
		assert.deepEqual(vue.ims.map(({ id }) => id).sort(), ['./index', './view', './view.render', './view.script']);
		assert.ok(vue.dependencies.some(({ specifier }) => specifier === 'vue'), JSON.stringify(vue.dependencies));
		const css = await read(vue.styles);
		assert.match(css, /\.counter\[data-v-[0-9a-f]+\]\s*\{\s*color:\s*rgb\(30, 64, 175\)/);
		assert.match(css, /\.vue-global\s*\{/);
		const code = await read(vue.file);
		assert.match(code, /component\.__scopeId = "data-v-/);
		assert.match(code, /require\('\.\/view\.script'\)/);
		return `${vue.ims.length} internal modules, 2 style blocks`;
	});

	await step('svelte: the component becomes one internal module with external CSS', async () => {
		const svelte = report.artifacts.find(one => one.specifier === '@fixture/ui/svelte-view');
		assert.deepEqual(svelte.ims.map(({ id }) => id).sort(), ['./index', './view']);
		assert.ok(svelte.dependencies.some(({ specifier }) => specifier.startsWith('svelte/internal')), JSON.stringify(svelte.dependencies));
		const css = await read(svelte.styles);
		assert.match(css, /\.counter\.svelte-[0-9a-z]+\s*\{\s*color:\s*rgb\(22, 101, 52\)/);
		return svelte.dependencies.map(({ specifier }) => specifier).join(', ');
	});

	await step('widget: the artifact registers the element with the Widgets runtime and declares itself a widget with styles', async () => {
		const widget = report.artifacts.find(one => one.specifier === '@fixture/ui/widget');
		assert.deepEqual(widget.widget, { name: 'fixture-widget', vspecifier: '@fixture/ui@0.1.0/widget', attrs: ['label'], global: true, render: { csr: true, ssr: false, sr: false } });
		const code = await read(widget.file);
		assert.match(code, /import \* as dependency_\d+ from '@beyond-js\/widgets\/render';/);
		assert.match(code, /\.widgets\.register\(\[\{"name":"fixture-widget","vspecifier":"@fixture\/ui@0\.1\.0\/widget","attrs":\["label"\],"global":true,"render":\{"csr":true,"ssr":false,"sr":false\}\}\]\);/);
		assert.match(code, /"type":"widget","styles":true/);
		assert.deepEqual(widget.dependencies, [{ specifier: '@beyond-js/widgets/render', source: 'external' }]);

		// The shared stylesheet is a public module declared by the package exports alone, with no code
		const global = report.artifacts.find(one => one.specifier === '@fixture/ui/global');
		assert.deepEqual(global.ims, []);
		assert.match(await read(global.styles), /\.fixture-card\s*\{/);
		assert.doesNotMatch(await read(global.styles), /\.card\s*\{|\.badge\s*\{/, 'the stylesheets of the other modules of the package are not part of it');
		return 'fixture-widget registered before initialise, with the global stylesheet of the package';
	});

	await step('conditionals: the web and node entries of one public module differ, and each excludes the other side', async () => {
		const client = report.artifacts.find(one => one.specifier === '@fixture/ui/render');
		assert.deepEqual(client.ims.map(({ id }) => id), ['./client/index']);
		const server = (await node.build()).artifacts.find(one => one.specifier === '@fixture/ui/render');
		assert.deepEqual(server.ims.map(({ id }) => id), ['./server/index']);
		assert.match(await read(client.file), /'client'/);
		assert.match(await read(server.file), /'server'/);
		return 'web → client/index, node → server/index';
	});

	await step('types: public declarations keep public type imports, hide internals, and a semantic error names its file and position', async () => {
		const typed = await types.build();
		const card = typed.artifacts.find(one => one.specifier === '@fixture/ui/card');
		assert.ok(card, JSON.stringify(typed.errors));
		const declaration = await read(card.file);
		assert.match(declaration, /declare module "@fixture\/ui\/card" \{\s*export \* from "@fixture\/ui@0\.1\.0\/card\/~\/index";/);
		assert.match(declaration, /from ['"]@fixture\/ui\/badge['"]/, 'the public type dependency stays public');
		assert.match(declaration, /declare module "@fixture\/ui@0\.1\.0\/card\/~\/title"/);
		assert.doesNotMatch(declaration, /from ['"]\.\/title['"]/, 'internal relative references are rewritten');
		assert.match(declaration, /card: \(badge: Badge\) => string/);

		const broken = typed.errors.filter(({ message }) => message.includes('@fixture/ui/broken'));
		assert.ok(broken.some(({ code, message }) => code === 'TS2322' && /index\.ts \(2:14\)/.test(message)), JSON.stringify(typed.errors));
		assert.ok(!typed.artifacts.some(one => one.specifier === '@fixture/ui/broken'), 'a module with type errors has no declaration');
		return `TS2322 at index.ts (2:14); ${typed.artifacts.length} declarations written`;
	});

	await step('kernel families: a source written against @beyond-js/kernel/core is assembled against the selected runtime', async () => {
		await writeFile(file('widget', 'events.ts'), "import { Events } from '@beyond-js/kernel/core';\nexport const events = new Events();\n");
		await writeFile(file('widget', 'index.ts'), "export { events } from './events';\nexport class Controller {\n\tstatic readonly element = 'fixture-widget';\n}\n");
		const widget = conditional('./widget');
		report = await rebuild(widget, () => Promise.resolve(), () => widget.valid && widget.artifact?.ims.some(({ id }) => id === './events'));
		const written = report.artifacts.find(one => one.specifier === '@fixture/ui/widget');
		const code = await read(written.file);
		assert.match(code, /import \* as dependency_\d+ from '@beyond-js\/local-2026\/core';/);
		assert.match(code, /\['@beyond-js\/kernel\/core', dependency_\d+\]/);
		assert.deepEqual(written.dependencies, [{ specifier: '@beyond-js/local-2026/core', source: 'runtime' }, { specifier: '@beyond-js/widgets/render', source: 'external' }]);
		return 'imported from the runtime, registered under the Kernel identity';
	});

	await step('production: the web/production conditional is the same composition, minified, without a map or an update patch', async () => {
		const production = new Artifacts(workspace, { path: out, conditions: { platform: 'web', environment: 'production' } });
		const built = await production.build();
		const errors = built.errors.map(({ code, message }) => `${code}: ${message}`);
		assert.deepEqual(errors, [], errors.join('\n'));
		const widget = built.artifacts.find(one => one.specifier === '@fixture/ui/widget');
		const development = report.artifacts.find(one => one.specifier === '@fixture/ui/widget');
		assert.deepEqual(widget.ims, development.ims, 'the same internal modules with the same hashes');
		assert.deepEqual(widget.dependencies, development.dependencies);
		assert.equal(widget.patch, void 0, 'production has no update patch');
		const code = await read(widget.file);
		assert.ok(code.split('\n').filter(line => line.trim()).length <= 3, 'minified into a few lines');
		assert.ok(code.length < (await read(development.file)).length * 0.8, 'smaller than the development output');
		assert.match(code, /widgets\.register\(/, 'the widget is registered');
		assert.doesNotMatch(code, /sourceMappingURL=data/, 'no inline map');
		const styles = await read(widget.styles);
		assert.ok(!styles.includes('\n') || styles.trim().split('\n').length === 1, 'the stylesheet is minified');
		assert.equal(conditional('./widget', 'web/production').output.hash === conditional('./widget').output.hash, false);
		return `${code.length} bytes of code, ${styles.length} bytes of stylesheet`;
	});

	await step('watch, tailwind: adding a class to a declared source adds its utility; removing it removes the utility', async () => {
		const badge = conditional('./badge');
		const before = badge.styles.hash;
		report = await rebuild(badge, () => writeFile(file('badge', 'view.ts'), "export const badge = (label: string) => `<span class=\"p-4 text-brand hidden\">${label}</span>`;\n"), () => badge.valid && /\.hidden\s*\{/.test(badge.styles?.code() ?? ''));
		assert.notEqual(badge.styles.hash, before);
		assert.match(badge.styles.code(), /\.hidden\s*\{/);

		report = await rebuild(badge, () => writeFile(file('badge', 'view.ts'), "export const badge = (label: string) => `<span class=\"p-4 text-brand\">${label}</span>`;\n"), () => badge.valid && !/\.hidden\s*\{/.test(badge.styles?.code() ?? ''));
		assert.doesNotMatch(badge.styles.code(), /\.hidden\s*\{/);
		assert.equal(badge.styles.hash, before, 'the stylesheet is what it was before the class was added');
		return 'utility added and removed with the candidate';
	});

	await step('watch, dependencies: a partial and a theme outside the module invalidate the modules that read them, and only those', async () => {
		const card = conditional('./card');
		const badge = conditional('./badge');
		const vue = conditional('./vue-view');
		const stable = { vue: vue.styles.hash, code: card.output.hash };

		await rebuild(card, () => writeFile(file('card', '_tokens.scss'), '$accent: rgb(1, 2, 3);\n$space: 8px;\n'), () => card.valid && /rgb\(1, 2, 3\)/.test(card.styles?.code() ?? ''));
		assert.match(card.styles.code(), /rgb\(1, 2, 3\)/);
		assert.equal(card.output.hash, stable.code, 'the code of the module did not change');

		const theme = badge.styles.hash;
		await rebuild(badge, () => writeFile(file('theme', 'tokens.css'), ':root { --fixture-brand: rgb(4, 5, 6); }\n'), () => badge.valid && /rgb\(4, 5, 6\)/.test(badge.styles?.code() ?? ''));
		assert.notEqual(badge.styles.hash, theme);
		assert.match(badge.styles.code(), /rgb\(4, 5, 6\)/);
		assert.equal(vue.styles.hash, stable.vue, 'an unrelated module is untouched');

		// The palette of another package of the workspace is a compile-time dependency, watched through that package
		assert.match(card.styles.code(), /border-color:\s*rgb\(20, 30, 40\)/, 'the palette of the shared package is included');
		const before = badge.styles.hash;
		await rebuild(card, () => writeFile(join(root, 'shared', 'palette.scss'), '$brand: rgb(7, 8, 9);\n\n.palette {\n\tcolor: $brand;\n}\n'), () => card.valid && /rgb\(7, 8, 9\)/.test(card.styles?.code() ?? ''));
		assert.match(card.styles.code(), /border-color:\s*rgb\(7, 8, 9\)/);
		assert.equal(badge.styles.hash, before, 'a module that does not read the palette is untouched');
		return 'partial → card; theme → badge; vue unchanged; palette of another package → card';
	});

	await step('watch, failure and recovery: an invalid stylesheet reports its position and publishes nothing; its correction restores the output', async () => {
		const card = conditional('./card');
		await rebuild(card, () => writeFile(file('card', 'styles.scss'), "@use 'tokens';\n.card { color: tokens.$missing; }\n"), () => !card.valid);
		assert.equal(card.valid, false);
		assert.ok(card.errors.some(({ code, message }) => code === 'STYLE_ERROR' && /styles\.scss \(2:16\)/.test(message)), JSON.stringify(card.errors));
		assert.equal(card.styles, void 0);
		assert.equal(card.output, void 0, 'a module with an invalid stylesheet is not published');

		await rebuild(card, () => writeFile(file('card', 'styles.scss'), "@use 'tokens';\n.card { color: tokens.$accent; padding: tokens.$space; }\n"), () => card.valid);
		assert.equal(card.valid, true, JSON.stringify(card.errors));
		assert.match(card.styles.code(), /rgb\(1, 2, 3\)/);
		return 'STYLE_ERROR with position, then valid again';
	});

	await step('watch, deletion: removing the last stylesheet of a module removes its stylesheet output', async () => {
		const card = conditional('./card');
		await rebuild(card, async () => {
			await rm(file('card', 'styles.scss'));
			await rm(file('card', 'extra.css'));
		}, () => card.valid && !card.styles);
		assert.equal(card.valid, true, JSON.stringify(card.errors));
		assert.equal(card.styles, void 0);
		assert.equal(card.artifact.styles, void 0);
		assert.match(await read(report.artifacts.find(one => one.specifier === '@fixture/ui/card').file.replace(/$/, '')), /"vspecifier":"@fixture\/ui@0\.1\.0\/card"\},"type":"ts"\}/);
		return 'no stylesheet, bundle specs without styles';
	});
} finally {
	// The order the development service establishes: the watchers service first, then its clients, whose
	// asynchronous releases fail harmlessly once the service is gone
	process.on('unhandledRejection', () => void 0);
	await service.stop().catch(error => console.log(`cleanup: ${error.message}`));
	try {
		workspace.destroy();
	} catch (error) {
		console.log(`cleanup: ${error.message}`);
	}
	await new Promise(resolve => setTimeout(resolve, 500));
	await rm(root, { recursive: true, force: true });
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
