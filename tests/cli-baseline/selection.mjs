/**
 * How a selector typed in a command becomes a public module: qualified and local forms, exact versions,
 * the packages of a workspace and a standalone package that has no workspace file.
 */
import assert from 'node:assert/strict';
import { step } from '../stage-1/harness.mjs';
import { Workspace } from '@beyond-js/packages/workspace';
import { Selection, Selector } from '@beyond-js/packages/workspace';
import { Fixture, bundlers } from './fixtures.mjs';

const pkg = (name, exports, values = {}) =>
	Object.assign({ name, version: '1.2.3', exports, beyond: { bundler: 'ts' }, bundlers }, values);
const code = `export const ok = true;\n`;

/**
 * Two packages that publish a module with the same subpath, a root module and a nested subpath
 */
const files = {
	'beyond.json': { packages: ['app', 'tools'] },
	'app/package.json': pkg('@example/app', { './main': './main/index.ts', '.': './src/index.ts' }),
	'app/main/index.ts': code,
	'app/src/index.ts': code,
	'tools/package.json': pkg('tools', { './main': './main/index.ts', './utils/text': './utils/text/index.ts' }),
	'tools/main/index.ts': code,
	'tools/utils/text/index.ts': code
};

export async function selection() {
	await step('selector: forms are parsed as public identities, never as files', async () => {
		const parsed = input => {
			const { valid, local, name, version, subpath, error } = new Selector(input);
			return valid ? { local, name, version, subpath } : error.code;
		};
		const expected = (name, subpath, version) => ({ local: false, name, version, subpath });

		assert.deepEqual(parsed('@example/app/main'), expected('@example/app', './main'));
		assert.deepEqual(parsed('@example/app@1.0.0/utils/text'), expected('@example/app', './utils/text', '1.0.0'));
		assert.deepEqual(parsed('app/main'), expected('app', './main'));
		assert.deepEqual(parsed('@example/app'), expected('@example/app', '.'));
		assert.deepEqual(parsed('./main'), { local: true, name: void 0, version: void 0, subpath: './main' });
		assert.deepEqual(parsed('.'), { local: true, name: void 0, version: void 0, subpath: '.' });

		for (const range of ['app@^1.0.0/main', 'app@latest/main', 'app@1.x/main', '@example/app@~1.2.0']) {
			assert.equal(parsed(range), 'SELECTOR_VERSION_UNSUPPORTED', range);
		}
		for (const path of ['../main', '/abs/main', './a/../b', 'app//main', '', '@/x', 'C:\\app\\main']) {
			assert.equal(parsed(path), 'SELECTOR_INVALID', path);
		}
		return '6 forms; ranges and paths rejected';
	});

	await step('selection: qualified selectors resolve, ambiguous shorthand does not', async () => {
		const fixture = await Fixture.create('selection', files);
		const workspace = new Workspace(fixture.root);
		try {
			const selection = new Selection(workspace);
			const resolved = async (input, directory) => {
				const { selected, errors } = await selection.resolve(input, directory);
				return selected ? selected.vspecifier : errors[0].code;
			};

			assert.equal(await resolved('@example/app/main'), '@example/app@1.2.3/main');
			assert.equal(await resolved('tools/main'), 'tools@1.2.3/main');
			assert.equal(await resolved('@example/app'), '@example/app@1.2.3');
			assert.equal(await resolved('tools/utils/text'), 'tools@1.2.3/utils/text');
			assert.equal(await resolved('@example/app@1.2.3/main'), '@example/app@1.2.3/main');
			assert.equal(await resolved('@example/app@2.0.0/main'), 'VERSION_MISMATCH');

			// The shorthand needs a current package: the workspace root is not one, a package directory is
			assert.equal(await resolved('./main', fixture.root), 'SELECTOR_PACKAGE_REQUIRED');
			assert.equal(await resolved('./main', fixture.path('app/main')), '@example/app@1.2.3/main');
			assert.equal(await resolved('./main', fixture.path('tools')), 'tools@1.2.3/main');
			assert.equal(await resolved('.', fixture.path('app')), '@example/app@1.2.3');

			assert.equal(await resolved('tools'), 'MODULE_NOT_FOUND', 'tools declares no root module');
			assert.equal(await resolved('./index.ts', fixture.path('app')), 'MODULE_NOT_FOUND', 'a file is not a module');
			assert.equal(await resolved('absent/main'), 'PACKAGE_NOT_FOUND');

			const { errors } = await selection.resolve('tools/absent');
			assert.match(errors[0].message, /declared: \.\/main, \.\/utils\/text/);
			return 'same "./main" in two packages: qualified ok, root shorthand rejected';
		} finally {
			workspace.destroy();
			await fixture.destroy();
		}
	});

	await step('selection: two packages with one name are rejected with both locations', async () => {
		const fixture = await Fixture.create('duplicates', {
			'beyond.json': { packages: ['one', 'two'] },
			'one/package.json': pkg('same', { './main': './main/index.ts' }),
			'one/main/index.ts': code,
			'two/package.json': pkg('same', { './main': './main/index.ts' }),
			'two/main/index.ts': code
		});
		const workspace = new Workspace(fixture.root);
		try {
			const { selected, errors } = await new Selection(workspace).resolve('same/main');
			assert.equal(selected, undefined);
			assert.equal(errors[0].code, 'PACKAGE_DUPLICATED');
			assert.match(errors[0].message, /one, two/);
			return errors[0].message;
		} finally {
			workspace.destroy();
			await fixture.destroy();
		}
	});

	await step('standalone package: a directory without beyond.json is a workspace of one package', async () => {
		const fixture = await Fixture.create('standalone', {
			'package.json': pkg('solo', { './main': './main/index.ts', '.': './src/index.ts' }),
			'main/index.ts': code,
			'src/index.ts': code
		});
		const workspace = new Workspace(fixture.root, { packages: ['.'] });
		try {
			const selection = new Selection(workspace);
			const root = await selection.resolve('./main', fixture.root);
			const inner = await selection.resolve('.', fixture.path('main'));
			assert.equal(root.selected?.vspecifier, 'solo@1.2.3/main');
			assert.equal(inner.selected?.vspecifier, 'solo@1.2.3');
			assert.equal((await selection.resolve('solo/main')).selected?.specifier, 'solo/main');

			const { readdir } = await import('node:fs/promises');
			assert.ok(!(await readdir(fixture.root)).includes('beyond.json'), 'no synthetic workspace file');
			return 'from the root and from an internal directory; nothing written';
		} finally {
			workspace.destroy();
			await fixture.destroy();
		}
	});
}
