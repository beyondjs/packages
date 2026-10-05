import test from 'node:test';
import assert from 'node:assert/strict';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, ContextError } from '../context.mjs';

/**
 * Which workspace a directory belongs to, on the fixtures of `fixtures/workspaces` (see its README) copied to
 * a unique temporary directory: `classic` as `ws`, `solo`, `empty`, `npm`, `outside` and `conflict`.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/workspaces/', import.meta.url));

/**
 * Copies fixtures to a unique temporary directory, each one `[fixture, path in the layout]`
 */
const layout = entries => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'beyond context ')));
	for (const [fixture, name = fixture] of entries) {
		mkdirSync(dirname(join(base, name)), { recursive: true });
		cpSync(join(FIXTURES, fixture), join(base, name), { recursive: true });
	}
	return base;
};

// What git does not keep is made here: an installed dependency, and links to a workspace and to a member
// that lives in another repository
const root = layout([['classic', 'ws'], ['solo'], ['empty'], ['npm'], ['outside'], ['conflict']]);
cpSync(join(FIXTURES, 'vendored'), join(root, 'solo/node_modules/dep'), { recursive: true });
symlinkSync(join(root, 'ws'), join(root, 'link'));
mkdirSync(join(root, 'outside/root/packages'));
symlinkSync(join('..', '..', 'repository', 'lib'), join(root, 'outside/root/packages/linked'), 'dir');

const located = directory => {
	const { root: found, standalone } = new Context({ directory: join(root, directory) });
	return [found.slice(root.length + 1), standalone];
};
const failure = options => {
	try {
		new Context(options);
	} catch (error) {
		assert.ok(error instanceof ContextError);
		return error;
	}
	assert.fail(`a context was established for ${JSON.stringify(options)}`);
};
const code = options => failure(options).code;
const ids = ({ members }) => members.map(({ id }) => id);
const reported = ({ declaration }) => declaration.diagnostics.map(({ code }) => code);

test.after(() => rmSync(root, { recursive: true, force: true }));

test('the nearest workspace file is the context of its declared packages', () => {
	assert.deepEqual(located('ws'), ['ws', false]);
	assert.deepEqual(located('ws/app/main/deep'), ['ws', false]);
	assert.deepEqual(located('ws/libs/shared'), ['ws', false], 'declared through its package.json');
	assert.deepEqual(located('ws/notes'), ['ws', false], 'inside the workspace, outside any package');
});

test('a package without a workspace file is a standalone context', () => {
	assert.deepEqual(located('solo'), ['solo', true]);
	assert.deepEqual(located('solo/src/inner'), ['solo', true]);
	assert.deepEqual(located('solo/node_modules/dep'), ['solo', true], 'an installed dependency is not a project');
});

test('a package below a workspace that does not declare it is not adopted', () => {
	assert.equal(code({ directory: join(root, 'ws/stray') }), 'CONTEXT_NOT_MEMBER');
	const explicit = new Context({ directory: join(root, 'ws/stray'), workspace: join(root, 'ws/stray') });
	assert.equal(explicit.standalone, true);
});

test('explicit roots are exact, and paths are canonical', () => {
	assert.equal(code({ directory: root, workspace: join(root, 'absent') }), 'CONTEXT_WORKSPACE_INVALID');
	assert.equal(code({ directory: root, workspace: join(root, 'empty') }), 'CONTEXT_WORKSPACE_INVALID');
	assert.equal(code({ directory: join(root, 'empty') }), 'CONTEXT_NOT_FOUND');
	const linked = new Context({ directory: join(root, 'link/app') });
	assert.equal(linked.root, join(root, 'ws'), 'one identity through a symbolic link');
});

test('an npm workspace is the context of its members, from its root, a member or a nested directory', () => {
	assert.deepEqual(located('npm'), ['npm', false]);
	assert.deepEqual(located('npm/packages/alpha'), ['npm', false]);
	assert.deepEqual(located('npm/packages/alpha/src/deep'), ['npm', false]);
	assert.deepEqual(located('npm/apps/web'), ['npm', false]);
	assert.deepEqual(located('npm/packages/notes'), ['npm', false], 'inside the workspace, outside any member');

	const { declaration } = new Context({ directory: join(root, 'npm/packages/alpha/src') });
	assert.deepEqual(
		[declaration.kind, declaration.root, ids(declaration)],
		['npm', join(root, 'npm'), ['packages/alpha', 'packages/beta', 'apps/web']]
	);
});

test('a package below an npm workspace that does not declare it is not adopted', () => {
	const stray = join(root, 'npm/tools/stray');
	const error = failure({ directory: stray });
	assert.equal(error.code, 'CONTEXT_NOT_MEMBER');
	assert.match(error.message, /"workspaces" or "beyond\.workspaces"/);

	const explicit = new Context({ directory: stray, workspace: stray });
	assert.deepEqual([explicit.standalone, explicit.declaration.kind], [true, 'standalone']);
});

test('an explicit root may be an npm workspace, named from anywhere', () => {
	const context = new Context({ directory: join(root, 'solo'), workspace: join(root, 'npm') });
	assert.deepEqual(
		[context.root, context.standalone, context.directory, context.declaration.kind],
		[join(root, 'npm'), false, join(root, 'solo'), 'npm']
	);
});

test('a member outside its root resolves to its own nearest configuration, and reaches its root explicitly', () => {
	const repository = ['outside/repository', false];
	assert.deepEqual(located('outside/shared/src'), ['outside/shared', true], 'no configuration above it: standalone');
	assert.deepEqual(located('outside/repository/lib/src'), repository, 'its repository declares it');
	assert.deepEqual(located('outside/root/packages/linked'), repository, 'a link leads to where its target is');
	assert.equal(new Context({ directory: join(root, 'outside/repository/lib') }).declaration.kind, 'beyond-json');

	const context = new Context({ directory: join(root, 'outside/shared/src'), workspace: join(root, 'outside/root') });
	assert.deepEqual([context.root, context.standalone], [join(root, 'outside/root'), false]);
	assert.equal(context.declaration.owner(context.directory).id, '../shared');
	assert.equal(context.declaration.member(join(root, 'outside/repository/lib')).id, 'packages/linked');
});

test('the context exposes what its root declares', () => {
	const classic = new Context({ directory: join(root, 'ws/app') }).declaration;
	assert.deepEqual([classic.kind, ids(classic), classic.valid], ['beyond-json', ['app', 'libs/shared'], true]);

	const solo = new Context({ directory: join(root, 'solo/src') }).declaration;
	assert.deepEqual(
		[solo.kind, solo.root, ids(solo), solo.members[0].name],
		['standalone', join(root, 'solo'), ['.'], 'solo']
	);
});

test('a workspace whose members cannot be decided is an error below it, and still the context at its root', () => {
	const error = failure({ directory: join(root, 'conflict/app/src') });
	assert.equal(error.code, 'CONTEXT_WORKSPACE_INVALID');
	assert.deepEqual(error.diagnostics.map(({ code }) => code), ['WORKSPACE_CONFIG_CONFLICT']);

	const context = new Context({ directory: join(root, 'conflict') });
	const { declaration } = context;
	assert.deepEqual([context.root, context.standalone, declaration.valid], [join(root, 'conflict'), false, false]);
	assert.deepEqual(declaration.diagnostics.map(({ code }) => code), ['WORKSPACE_CONFIG_CONFLICT']);
});

test('a package.json that cannot be read is reported by the declaration, never refused by the context', t => {
	const base = layout([['npm']]);
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const member = join(base, 'npm/apps/web/package.json');
	const original = readFileSync(member, 'utf8');

	// A member's manifest: the workspace is the context, and the member stays listed with its error
	writeFileSync(member, '{ "name": "@fixture/web", ');
	const broken = new Context({ directory: join(base, 'npm/apps/web') });
	assert.deepEqual(
		[broken.root, broken.standalone, reported(broken)],
		[join(base, 'npm'), false, ['MEMBER_MANIFEST_INVALID']]
	);
	assert.deepEqual(broken.declaration.diagnostics[0].paths, [member]);
	assert.deepEqual(ids(broken.declaration), ['packages/alpha', 'packages/beta', 'apps/web']);

	writeFileSync(member, original);
	assert.equal(new Context({ directory: join(base, 'npm/apps/web') }).declaration.valid, true);

	// The root's manifest, with no package between it and the directory: by what exists, it is the nearest
	// package and a standalone context, whose declaration says why it cannot be told more
	writeFileSync(join(base, 'npm/package.json'), '{ "workspaces": ');
	const root = new Context({ directory: join(base, 'npm/packages/notes') });
	assert.deepEqual(
		[root.root, root.standalone, reported(root)],
		[join(base, 'npm'), true, ['WORKSPACE_CONFIG_INVALID', 'MEMBER_MANIFEST_INVALID']]
	);
});

test('a package.json above the nearest package that cannot be read declares no workspace; the search goes on', t => {
	// A broken manifest high in the tree, as in a home directory, above a standalone package and two workspaces
	const projects = ['solo', 'classic', 'npm'].map(fixture => [fixture, join('home/projects', fixture)]);
	const base = layout(projects);
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const home = join(base, 'home');
	writeFileSync(join(home, 'package.json'), '{ "name": ');

	const solo = new Context({ directory: join(home, 'projects/solo/src/inner') });
	assert.deepEqual([solo.root, solo.standalone], [join(home, 'projects/solo'), true]);
	const classic = new Context({ directory: join(home, 'projects/classic/app/main/deep') });
	assert.deepEqual([classic.root, classic.declaration.kind], [join(home, 'projects/classic'), 'beyond-json']);

	// The manifest of a workspace root is no exception: when it cannot be read, a member below it is on its own
	writeFileSync(join(home, 'projects/npm/package.json'), '{ "workspaces": ');
	const alpha = new Context({ directory: join(home, 'projects/npm/packages/alpha/src') });
	assert.deepEqual(
		[alpha.root, alpha.standalone, alpha.declaration.kind],
		[join(home, 'projects/npm/packages/alpha'), true, 'standalone']
	);
});

test('an explicit root with a package.json that cannot be read is accepted, and its declaration reports it', t => {
	const base = layout([['npm'], ['classic']]);
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const manifest = join(base, 'npm/package.json');
	const original = readFileSync(manifest, 'utf8');

	// Without a beyond.json, what exists is a package: a standalone context
	writeFileSync(manifest, '{ "workspaces": ');
	const npm = new Context({ directory: base, workspace: join(base, 'npm') });
	assert.deepEqual(
		[npm.root, npm.standalone, npm.declaration.valid, reported(npm)],
		[join(base, 'npm'), true, false, ['WORKSPACE_CONFIG_INVALID', 'MEMBER_MANIFEST_INVALID']]
	);
	assert.match(npm.declaration.diagnostics[0].message, /npm\/package\.json" cannot be read: /);

	// With a beyond.json beside it, a workspace whose members are still read
	writeFileSync(join(base, 'classic/package.json'), '[');
	const classic = new Context({ directory: base, workspace: join(base, 'classic') });
	assert.deepEqual(
		[classic.standalone, classic.declaration.kind, ids(classic.declaration), reported(classic)],
		[false, 'beyond-json', ['app', 'libs/shared'], ['WORKSPACE_CONFIG_INVALID']]
	);

	writeFileSync(manifest, original);
	const corrected = new Context({ directory: base, workspace: join(base, 'npm') });
	assert.deepEqual(
		[corrected.root, corrected.standalone, corrected.declaration.kind, corrected.declaration.valid],
		[join(base, 'npm'), false, 'npm', true]
	);
});
