/**
 * The declarations of the modules of an installed workspace (the `tsc` processor of the `ts` bundler): every
 * bare specifier and type reference resolved through the edges of the package that imports it, a peer in the
 * context of the dependent, a member through its declaration and never its sources, an alias under its own
 * name, canonical paths, and nothing from the toolchain. The fixtures are `fixtures/workspace` (see its
 * README); the harness is `support/workspace.mjs`.
 *
 * ```sh
 * # BEE_URL and BEE_NODE_DIR: the bootstrap Engine serving this checkout and the loader (tests/stage-1/README.md)
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/workspace-types.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Delivery } from '@beyond-js/packages/artifacts';
import { IDS, BOUND, codes, prepare, open } from './support/workspace.mjs';

// The compiler the processor runs, the same instance: what it reads from disk is observed through its system
const ts = createRequire(join(process.cwd(), 'package.json'))('typescript');

/**
 * The declarations of an installed workspace
 *
 * @param {{ store?: 'link', linked?: boolean, ids?: string[] }} options The store or the members reached
 * through symbolic links, and the members given
 */
async function declarations(t, { store, linked = false, ids = IDS } = {}) {
	const prepared = await prepare(t, { store });
	const workspace = await open(t, prepared.root, { members: prepared.members(ids, linked), execution: prepared.execution() });
	const delivery = new Delivery(workspace);
	const declaration = (name, subpath, version = '1.0.0') => delivery.declaration({ name, version, subpath });
	return { ...prepared, delivery, declaration };
}

const failed = ({ failure }) => codes(failure?.diagnostics);
const built = (result, label) => assert.equal(result.failure, undefined, `${label}: ${JSON.stringify(result.failure?.diagnostics ?? result.failure)}`);

test('importers: each package is typed with its own versions, and a peer in the context of its dependent', BOUND, async t => {
	const { declaration } = await declarations(t);

	// `greeting@1` for app-v1 and `greeting@2` for app-v2, each also through `kit`, whose peer the context binds
	for (const name of ['@fixture/app-v1', '@fixture/app-v2']) {
		const typed = await declaration(name, './typed');
		built(typed, name);
		assert.match(typed.declaration.code, /wrapped: string/);

		// Each one fails with the greeting of the other version: kit's peer is not left untyped
		const mismatch = await declaration(name, './mismatch');
		assert.equal(mismatch.failure?.code, 'BUILD_FAILED', name);
		assert.ok(failed(mismatch).includes('TS2353'), `${name}: ${failed(mismatch).join(', ')}`);
	}
});

test('toolchain: with an execution nothing is typed from the toolchain, and without one as before', BOUND, async t => {
	const { root, members, declaration } = await declarations(t);

	// `typescript` and `@types/node` are the toolchain's, not installed for the workspace
	const toolchain = await declaration('@fixture/app-v1', './toolchain');
	assert.equal(toolchain.failure?.code, 'BUILD_FAILED');
	assert.ok(failed(toolchain).includes('TS2307'), failed(toolchain).join(', '));
	assert.ok(failed(toolchain).some(code => ['TS2580', 'TS2591'].includes(code)), failed(toolchain).join(', '));

	const legacy = new Delivery(await open(t, root, { members: members(IDS) }));
	built(await legacy.declaration({ name: '@fixture/app-v1', version: '1.0.0', subpath: './toolchain' }), 'without an execution');
});

test('members: a member reached through the declaration of another is typed by its declaration, never its sources', BOUND, async t => {
	const { outside, declaration } = await declarations(t);

	// The declarations app-v3 reads are built first, by their own programs
	built(await declaration('@fixture/message', './main', '2.0.0'), 'message-v2');
	built(await declaration('@fixture/wrap', './main'), 'wrap');

	const read = [];
	const { readFile } = ts.sys;
	ts.sys.readFile = (file, encoding) => {
		file.startsWith(outside) && read.push(file);
		return readFile.call(ts.sys, file, encoding);
	};
	t.after(() => {
		ts.sys.readFile = readFile;
	});
	const app = await declaration('@fixture/app-v3', './main');
	ts.sys.readFile = readFile;

	built(app, 'app-v3: a string from the declaration of message-v2, which the directive proves');
	assert.deepEqual(read, [], 'no file of the member message-v2 is read by the program of app-v3');
});

test('aliases: a member imported under another name is declared by that name, beside the version of its own name', BOUND, async t => {
	const { declaration } = await declarations(t);
	const alias = await declaration('@fixture/app-v1', './alias');
	built(alias, 'app-v1/alias');
	assert.match(alias.declaration.code, /second: string\[\]/);
	assert.match(alias.declaration.code, /first: string;/);
});

test('canonical paths: members and the store reached through symbolic links keep their types', BOUND, async t => {
	const { declaration } = await declarations(t, { store: 'link', linked: true });
	built(await declaration('@fixture/app-v1', './typed'), 'app-v1/typed');

	// Through the link of the store, kit's peer is still the greeting of app-v1, which has no words
	const mismatch = await declaration('@fixture/app-v1', './mismatch');
	assert.ok(failed(mismatch).includes('TS2353'), failed(mismatch).join(', '));
});

test('a package the graph does not have: its own modules and the builtins need no edge, another package does', BOUND, async t => {
	const { declaration } = await declarations(t, { ids: [...IDS, 'unlisted'] });
	const unlisted = subpath => declaration('@fixture/unlisted', subpath);

	built(await unlisted('./self'), 'unlisted/self');
	const foreign = await unlisted('./foreign');
	assert.ok(failed(foreign).includes('DEPENDENCY_NOT_INSTALLED'), failed(foreign).join(', '));
	assert.match(foreign.failure.diagnostics.find(({ code }) => code === 'DEPENDENCY_NOT_INSTALLED').message, /imports greeting, but it is not a package of the installed graph/);

	// node:path has no edge to follow, and no types without @types/node: TS2307, and nothing more
	const builtin = await unlisted('./builtin');
	assert.ok(failed(builtin).includes('TS2307'), failed(builtin).join(', '));
	assert.ok(!failed(builtin).includes('DEPENDENCY_NOT_INSTALLED'), failed(builtin).join(', '));
});

test('mapped paths and type references: the author maps from the module, a directive follows the edges', BOUND, async t => {
	const { declaration } = await declarations(t);

	// `local/value` is mapped by the tsconfig of the module to a file of the module, not looked for as a package
	built(await declaration('@fixture/app-v1', './mapped'), 'app-v1/mapped');

	// `/// <reference types>` reaches `@types/plain`, an edge of app-v1, and not `@types/node`, which it has not
	built(await declaration('@fixture/app-v1', './reference'), 'app-v1/reference');
	const unreferenced = await declaration('@fixture/app-v1', './unreferenced');
	assert.ok(failed(unreferenced).includes('TS2688'), failed(unreferenced).join(', '));
});
