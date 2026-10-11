/**
 * Confined compilation: the analysis and the generation of packages whose sources the caller does not trust
 * load no code a package supplies and read no file outside a package, and the same packages compile as before
 * when the caller does not select it. Read the README of this directory.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" --test tests/confinement/confinement.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { Analysis, Toolchain } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';
import { Package } from '@beyond-js/packages/package';
import { Store } from './support/store.mjs';
import { Probe } from './support/probe.mjs';

const compiler = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const conditions = { platform: 'browser', environment: 'development' };

/**
 * What a confined compilation refuses: the case, the package and subpath, the code, and the kind of code that
 * would have run when there is one
 */
const REFUSED = [
	['a Tailwind plugin the package supplies', '@fixture/tailwind-hostile', 'plugin', 'PLUGIN_REFUSED', 'plugin'],
	['a Tailwind configuration the package supplies', '@fixture/tailwind-hostile', 'config', 'PLUGIN_REFUSED', 'config'],
	['a Tailwind @import of an absolute path', '@fixture/tailwind-hostile', 'absolute', 'SOURCE_CONFINED'],
	['a Tailwind @import that leaves the package', '@fixture/tailwind-hostile', 'escape', 'SOURCE_CONFINED'],
	['Tailwind sources reached through a link that leaves the package', '@fixture/tailwind-hostile', 'sources', 'SOURCE_CONFINED'],
	['a Sass @use of an absolute path', '@fixture/sass-hostile', 'absolute', 'SOURCE_CONFINED'],
	['a Sass @use that leaves the package', '@fixture/sass-hostile', 'escape', 'SOURCE_CONFINED'],
	['a stylesheet input that is a link leaving the package', '@fixture/inputs-hostile', 'linked', 'SOURCE_CONFINED'],
	['processor inputs whose directory leaves the package', '@fixture/inputs-hostile', 'path', 'SOURCE_CONFINED'],
	['a bundler the package names as a data: URL', '@fixture/bundler-hostile', 'widget', 'PLUGIN_REFUSED', 'bundler'],
	['a processor the module manifest names as a data: URL', '@fixture/processor-hostile', 'widget', 'PLUGIN_REFUSED', 'processor'],
	['a toolchain bundler that does not compose confined, registered under another name', '@fixture/legacy-hostile', 'widget', 'PLUGIN_REFUSED'],
	['an import of an absolute path', '@fixture/esbuild-hostile', 'absolute', 'SOURCE_CONFINED'],
	['an import that leaves the package', '@fixture/esbuild-hostile', 'escape', 'SOURCE_CONFINED'],
	['an import of an absolute text file', '@fixture/esbuild-hostile', 'text', 'SOURCE_CONFINED'],
	['an import of a link that leaves the package', '@fixture/esbuild-hostile', 'linked', 'SOURCE_CONFINED'],
	['a CSS @import of an absolute path', '@fixture/esbuild-hostile', 'styles', 'SOURCE_CONFINED'],
	['a CommonJS re-export that leaves the package', '@fixture/esbuild-hostile', 'reexport', 'SOURCE_CONFINED']
];

test('confined compilation', { timeout: 900_000 }, async t => {
	const store = await new Store().create();
	const probe = await new Probe(store.root).start();
	t.after(async () => {
		await probe.close();
		await rm(store.root, { recursive: true, force: true });
	});

	const { graph, sources } = store;
	const trace = (specifier, confined) => Analysis.trace({ graph, sources, entries: [specifier], conditions, compiler, format: 'esm', confined });
	const generate = (item, confined) => Generation.unit({ item, graph, sources, conditions, compiler, format: 'esm', confined });
	const errors = inventory => inventory.diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code);
	// The runtime the composed modules reference is the installed Kernel, whose bundle has dynamic imports no
	// trace can know (`DYNAMIC_IMPORT_UNKNOWN`): those errors are the runtime's, not the fixture's
	const own = inventory => inventory.diagnostics.filter(({ severity, message }) => severity === 'error' && !message.includes('"@beyond-js/kernel/'));
	const item = (name, subpath, kind = 'module') => ({ kind, package: store.key(name), subpath });
	const output = (generated, kind) => generated.outputs.find(one => one.kind === kind)?.code ?? '';

	await t.test('what a package supplies or reaches outside itself is refused, by its code, and nothing of it runs or is read', async () => {
		for (const [what, name, subpath, code, kind] of REFUSED) {
			const inventory = await trace(`${name}/${subpath}`, true);
			assert.ok(errors(inventory).includes(code), `${what}: the trace answers ${code} (${JSON.stringify(inventory.diagnostics)})`);
			assert.equal(Probe.leaked(inventory), false, `${what}: the trace discloses nothing outside the package`);

			const generated = await generate(item(name, subpath), true);
			assert.deepEqual(generated.outputs, [], `${what}: nothing is generated`);
			assert.ok(generated.diagnostics.some(diagnostic => diagnostic.code === code), `${what}: the generation answers ${code} (${JSON.stringify(generated.diagnostics)})`);
			assert.equal(Probe.leaked(generated), false, `${what}: the generation discloses nothing outside the package`);
			kind && assert.equal(probe.executed(kind), false, `${what}: the code never ran`);
		}
		assert.equal(probe.connections, 0, 'no code a package supplies opened a connection');
	});

	await t.test('a static file that is a link leaving its package is refused, in the trace and in its generation', async () => {
		const inventory = await trace('@fixture/assets-hostile', true);
		assert.ok(errors(inventory).includes('SOURCE_CONFINED'), JSON.stringify(inventory.diagnostics));
		const generated = await generate(item('@fixture/assets-hostile', 'linked.txt', 'asset'), true);
		assert.deepEqual([generated.outputs, generated.diagnostics.map(({ code }) => code)], [[], ['SOURCE_CONFINED']]);
		assert.equal(Probe.leaked([inventory, generated]), false);
	});

	await t.test('a TypeScript configuration that extends a file outside the package is compiled without reading it', async () => {
		const confined = await generate(item('@fixture/tsconfig-hostile', '.'), true);
		assert.deepEqual(confined.diagnostics, []);
		assert.match(output(confined, 'js'), /answer = 42/);
		assert.equal(Probe.leaked(confined), false, 'the base outside the package was not read');

		// Not confined, the compiler reads the base and reports its first token, which is how it disclosed a file
		const open = await generate(item('@fixture/tsconfig-hostile', '.'), false);
		assert.equal(Probe.leaked(open), true, 'the development behavior is unchanged');
	});

	await t.test('clean packages compile confined: Tailwind from the toolchain, a Sass partial, an inside base configuration', async () => {
		const styles = store.key('@fixture/clean-styles');
		const inventory = await trace('@fixture/clean-styles/tailwind', true);
		assert.deepEqual(own(inventory), []);
		const tailwind = await generate(inventory.items.find(({ id }) => id === `style:${styles}/tailwind`), true);
		assert.deepEqual(tailwind.diagnostics, []);
		assert.match(output(tailwind, 'css'), /\.flex\s*\{/);
		assert.match(output(tailwind, 'css'), /\.p-4\s*\{/);
		assert.equal(tailwind.provenance.compiler.confined, true, 'the provenance says the output was compiled confined');

		const scss = await trace('@fixture/clean-styles/scss', true);
		assert.deepEqual(own(scss), []);
		const sheet = await generate(scss.items.find(({ id }) => id === `style:${styles}/scss`), true);
		assert.deepEqual(sheet.diagnostics, []);
		assert.match(output(sheet, 'css'), /\.card\s*\{\s*color: rgb\(37, 99, 235\)/);

		const plain = store.key('@fixture/clean-plain');
		const traced = await trace('@fixture/clean-plain', true);
		assert.deepEqual(own(traced), []);
		assert.ok(traced.items.some(({ id }) => id === `asset:${plain}/logo.svg`), 'the static file it uses is an item');
		const module = await generate(traced.items.find(({ id }) => id === `module:${plain}/.`), true);
		assert.deepEqual(module.diagnostics, []);
		assert.match(output(module, 'js'), /greeting/);
		assert.match(output(module, 'css'), /\.base[\s\S]*\.plain/);
		const view = await generate(item('@fixture/clean-plain', 'view'), true);
		assert.match(output(view, 'js'), /h\("b"/, 'the base configuration inside the package is applied');
	});

	await t.test('a confined key never stands for an unconfined one, and an unconfined key is unchanged', async () => {
		const confined = await trace('@fixture/clean-plain', true);
		const open = await trace('@fixture/clean-plain', false);
		const keys = inventory => Object.fromEntries(inventory.items.map(({ id, key }) => [id, key]));
		const [locked, free] = [keys(confined), keys(open)];
		assert.deepEqual(Object.keys(locked).sort(), Object.keys(free).sort());
		Object.keys(locked).forEach(id => assert.notEqual(locked[id], free[id], `${id} has a key of its own when confined`));

		assert.deepEqual(Toolchain.copied, Toolchain.copy(false));
		const asset = open.items.find(({ kind }) => kind === 'asset');
		assert.equal(asset.inputs.compiler.configuration, Toolchain.copied.compiler.configuration, 'an unconfined static file keeps the configuration it had');
		const generated = await generate(open.items.find(({ kind }) => kind === 'module'), false);
		assert.equal(generated.provenance.compiler.confined, undefined, 'an unconfined provenance does not mention confinement');
	});

	await t.test('a package read confined refuses the declaration processor, whose program is not confined', async () => {
		const declaration = async confined => {
			const pkg = new Package(store.sources[store.key('@fixture/clean-styles')], { confined });
			try {
				await pkg.ready;
				await pkg.modules.ready;
				const module = pkg.modules.get('./scss');
				await module.conditionals.ready;
				const types = module.conditionals.get('types');
				await types.ready;
				return types.errors.map(({ code }) => code);
			} finally {
				pkg.destroy();
			}
		};
		assert.deepEqual(await declaration(true), ['PLUGIN_REFUSED']);
		assert.deepEqual(await declaration(false), [], 'without confinement the declaration builds');
	});

	await t.test('without confinement the same fixtures compile as they did: plugins run and files outside are read', async () => {
		const plugin = await trace('@fixture/tailwind-hostile/plugin', false);
		assert.ok(!errors(plugin).includes('PLUGIN_REFUSED'), JSON.stringify(plugin.diagnostics));
		assert.equal(probe.executed('plugin'), true, 'the plugin the package supplies ran');
		await probe.connection();

		const read = [
			['@fixture/tailwind-hostile', 'escape', 'css'],
			['@fixture/sass-hostile', 'escape', 'css'],
			['@fixture/inputs-hostile', 'linked', 'css'],
			['@fixture/esbuild-hostile', 'escape', 'js']
		];
		for (const [name, subpath, kind] of read) {
			const generated = await generate(item(name, subpath), false);
			assert.equal(Probe.leaked(output(generated, kind)), true, `${name}/${subpath} reads the file outside its package`);
		}
	});
});
