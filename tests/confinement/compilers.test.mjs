/**
 * Confined compilation, where the compilers reach files on their own: the input source maps a file names, the
 * directories a pattern import expands to, the types a Vue component imports, the implementations a package
 * ships under the names the toolchain allows, and the debug output of the exports bundler. Read the README of
 * this directory.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" --test tests/confinement/compilers.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { Analysis } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';
import { Store } from './support/store.mjs';
import { Probe } from './support/probe.mjs';

const compiler = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const browser = { platform: 'browser', environment: 'development' };

/**
 * The names of the files outside the packages, which a confined diagnostic never carries
 */
const OUTSIDE = ['secret.json', 'other.json', 'secret.txt', 'secret.js.map', 'secret.cjs', 'types.ts'];

test('confined compilation where the compilers reach files on their own', { timeout: 900_000 }, async t => {
	const store = await new Store().create();
	const probe = await new Probe(store.root).start();
	t.after(async () => {
		await probe.close();
		await rm(store.root, { recursive: true, force: true });
	});

	const { graph, sources } = store;
	const trace = (specifier, confined) => Analysis.trace({ graph, sources, entries: [specifier], conditions: browser, compiler, format: 'esm', confined });
	const generate = (name, subpath, confined, conditions = browser) => {
		const item = { kind: 'module', package: store.key(name), subpath };
		return Generation.unit({ item, graph, sources, conditions, compiler, format: 'esm', confined });
	};
	// The Kernel the composed modules reference has dynamic imports no trace can know: those errors are its own
	const errors = inventory => inventory.diagnostics.filter(({ severity, message }) => severity === 'error' && !message.includes('"@beyond-js/kernel/'));
	const output = (generated, kind) => generated.outputs.find(one => one.kind === kind)?.code ?? '';
	const named = value => OUTSIDE.filter(name => JSON.stringify(value).includes(name));

	await t.test('an input source map that reaches outside the package is not read: the file compiles without it', async () => {
		for (const subpath of ['comment', 'styled', 'mapped', 'inline']) {
			const inventory = await trace(`@fixture/maps-hostile/${subpath}`, true);
			assert.deepEqual(errors(inventory), [], `${subpath}: the trace compiles`);
			const generated = await generate('@fixture/maps-hostile', subpath, true);
			assert.deepEqual(generated.diagnostics, [], `${subpath}: the generation compiles`);
			assert.ok(output(generated, 'map'), `${subpath}: it still has a map of its own`);
			assert.equal(Probe.leaked([inventory, generated]), false, `${subpath}: nothing outside reaches the inventory, the outputs or the maps`);
		}

		// Not confined, the compiler reads them: the first token of a file in its error, an outside map's sources
		assert.equal(Probe.leaked(await generate('@fixture/maps-hostile', 'comment', false)), true);
		assert.equal(Probe.leaked(await generate('@fixture/maps-hostile', 'inline', false)), true);
	});

	await t.test('an input source map inside the package, with the content of its sources, is kept as it was', async () => {
		const confined = await generate('@fixture/maps-hostile', 'kept', true);
		const open = await generate('@fixture/maps-hostile', 'kept', false);
		assert.match(output(confined, 'map'), /original source kept/);
		assert.equal(output(confined, 'map'), output(open, 'map'));
	});

	await t.test('a pattern import that leaves the package is refused once, before the compiler lists anything', async () => {
		for (const subpath of ['template', 'concat', 'climb']) {
			const inventory = await trace(`@fixture/globs-hostile/${subpath}`, true);
			const refused = inventory.diagnostics.filter(({ code }) => code === 'SOURCE_CONFINED');
			assert.equal(refused.length, 1, `${subpath}: ${JSON.stringify(inventory.diagnostics)}`);
			const generated = await generate('@fixture/globs-hostile', subpath, true);
			assert.deepEqual(generated.diagnostics.map(({ code }) => code), ['SOURCE_CONFINED']);
			assert.deepEqual(named([inventory, generated]), [], `${subpath}: no file outside the package is named`);
			assert.equal(Probe.leaked([inventory, generated]), false);
		}

		const local = await generate('@fixture/globs-hostile', 'local', true);
		assert.deepEqual(local.diagnostics, []);
		assert.match(output(local, 'js'), /hello/, 'a pattern inside the package is expanded as before');
		assert.equal(Probe.leaked(await generate('@fixture/globs-hostile', 'template', false)), true, 'not confined, the pattern is expanded as before');
	});

	await t.test('a Vue component reads the types it imports only from inside its package', async () => {
		const typed = await generate('@fixture/vue-hostile', 'typed', true);
		assert.ok(typed.diagnostics.some(({ code }) => code === 'VUE_SCRIPT_ERROR'), JSON.stringify(typed.diagnostics));
		assert.equal(Probe.leaked(typed), false, 'the properties of a type outside the package are not read');

		const blocks = await generate('@fixture/vue-hostile', 'blocks', true);
		assert.deepEqual(blocks.diagnostics, []);
		assert.equal(Probe.leaked(blocks), false, 'a block that names a file outside the package reads nothing');
		assert.equal(Probe.leaked(await generate('@fixture/vue-hostile', 'typed', false)), true, 'not confined, the type is read as before');
	});

	await t.test('a Svelte component that names files outside its package reads none of them', async () => {
		const view = await generate('@fixture/svelte-hostile', 'view', true);
		assert.deepEqual(view.diagnostics, []);
		assert.equal(Probe.leaked(view), false);
	});

	await t.test('a package that ships its own copy of an allowed bundler or processor runs the toolchain one', async () => {
		for (const confined of [true, false]) {
			const generated = await generate('@fixture/shadow-hostile', 'widget', confined);
			assert.deepEqual(generated.diagnostics, []);
			assert.equal(generated.provenance.compiler.name, '@beyond-js/packages/bundlers/ts');
			assert.match(output(generated, 'css'), /\.widget/);
		}
		assert.deepEqual([probe.executed('shadow-bundler'), probe.executed('shadow-processor')], [false, false]);
	});

	await t.test('the exports bundler writes no debug output into the working directory', async () => {
		const cwd = process.cwd();
		process.chdir(store.root);
		try {
			const generated = await generate('@fixture/legacy-hostile', 'widget', false, { platform: 'node', environment: 'development' });
			assert.ok(output(generated, 'js'), JSON.stringify(generated.diagnostics));
			assert.equal(existsSync(join(store.root, 'output.js')), false);
		} finally {
			process.chdir(cwd);
		}
	});
});
