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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Declaration } from '../workspace/declaration.mjs';

/**
 * The forms of a workspace declaration and the members each one yields, on the fixtures of
 * `fixtures/workspaces` (see its README), copied to a unique temporary directory for each case.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/workspaces/', import.meta.url));

const layout = (t, ...names) => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'beyond declaration ')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	names.forEach(name => cpSync(join(FIXTURES, name), join(base, name), { recursive: true }));
	return base;
};
const edit = (file, change) => writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8')))));
const redeclare = (root, workspaces) => edit(join(root, 'package.json'), manifest => ({ ...manifest, workspaces }));
const link = (root, name, target) => symlinkSync(target, join(root, name), 'dir');
const ids = declaration => declaration.members.map(({ id }) => id);
const codes = declaration => declaration.diagnostics.map(({ code }) => code);

test('npm workspaces as an array: members matched by patterns, in pattern order and then by path', t => {
	const root = join(layout(t, 'npm'), 'npm');
	const declaration = Declaration.read(root);

	assert.equal(declaration.kind, 'npm');
	assert.equal(declaration.root, root);
	assert.equal(declaration.manifest.name, 'npm-root');
	assert.deepEqual(ids(declaration), ['packages/alpha', 'packages/beta', 'apps/web']);
	assert.deepEqual(declaration.diagnostics, [], 'a matched directory without package.json and a file are skipped');
	assert.equal(declaration.valid, true);

	const [alpha] = declaration.members;
	assert.deepEqual(
		{ ...alpha, manifest: alpha.manifest.description },
		{
			id: 'packages/alpha',
			path: join(root, 'packages/alpha'),
			name: '@fixture/alpha',
			version: '1.0.0',
			manifest: 'The first member',
			source: 'workspaces'
		}
	);
	assert.ok(Object.isFrozen(declaration.members) && Object.isFrozen(alpha), 'a declaration is a snapshot');
});

test('npm workspaces as an object with a packages array', t => {
	const declaration = Declaration.read(join(layout(t, 'object'), 'object'));
	assert.equal(declaration.kind, 'npm');
	assert.deepEqual(ids(declaration), ['packages/one', 'packages/two']);
	assert.equal(declaration.valid, true);
});

test('negations remove matches, two marks are none, and a later pattern withdraws a negation that matches it', t => {
	const root = join(layout(t, 'negation'), 'negation');
	const { workspaces } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	assert.deepEqual(ids(Declaration.read(root)), ['packages/kept', 'extra/again']);

	// npm's rule: a pattern that a negation matches withdraws that negation, for every match
	redeclare(root, [...workspaces, 'packages/legacy-two']);
	const restored = ['packages/kept', 'packages/legacy-one', 'packages/legacy-two', 'extra/again'];
	assert.deepEqual(ids(Declaration.read(root)), restored);

	// A pattern that a negation removes is not expanded, and is not reported as matching nothing
	redeclare(root, ['packages/excluded', '!packages/excluded']);
	const declaration = Declaration.read(root);
	assert.deepEqual([ids(declaration), codes(declaration)], [[], []]);
});

test('nothing inside node_modules is a member, and a wildcard does not select the root as `.`', t => {
	const root = join(layout(t, 'globstar'), 'globstar');
	for (const directory of ['node_modules/vendored', 'libs/node_modules/vendored', 'libs/a/node_modules/vendored']) {
		cpSync(join(FIXTURES, 'vendored'), join(root, directory), { recursive: true });
	}

	// The root has no version: as a member it would be invalid
	const declaration = Declaration.read(root);
	assert.deepEqual([ids(declaration), codes(declaration)], [['libs/a', 'libs/a/nested'], []]);

	redeclare(root, ['libs/node_modules/vendored']);
	assert.deepEqual(codes(Declaration.read(root)), ['WORKSPACE_PATTERN_EMPTY'], 'not even when named exactly');

	// Named, the root is a member, and its manifest is held to what a member needs
	redeclare(root, ['.', 'libs/a']);
	const named = Declaration.read(root);
	assert.deepEqual([ids(named), codes(named)], [['.', 'libs/a'], ['MEMBER_MANIFEST_INVALID']]);
});

test('members outside the root: `..` paths, and symbolic links, identified by their real directory', t => {
	const base = layout(t, 'outside');
	const root = join(base, 'outside/root');
	mkdirSync(join(root, 'packages'));
	link(root, 'packages/linked', join('..', '..', 'repository', 'lib'));

	const declaration = Declaration.read(root);
	assert.deepEqual(ids(declaration), ['app', '../shared', 'packages/linked']);
	assert.equal(declaration.members[1].path, join(base, 'outside/shared'));
	assert.equal(declaration.members[2].path, join(base, 'outside/repository/lib'), 'a link is known by its target');
	assert.equal(declaration.valid, true);

	// One directory is one member, named by the first entry that reaches it
	redeclare(root, ['app', '../shared', 'packages/*', '../repository/lib']);
	assert.deepEqual(ids(Declaration.read(root)), ['app', '../shared', 'packages/linked']);
	redeclare(root, ['../repository/lib', 'packages/*']);
	assert.deepEqual(ids(Declaration.read(root)), ['../repository/lib']);

	// A wildcard that leaves the root and comes back into it selects it by its name, as npm does
	edit(join(root, 'package.json'), manifest => ({ ...manifest, version: '1.0.0', workspaces: ['../*'] }));
	const parent = Declaration.read(root);
	assert.deepEqual([ids(parent), parent.valid], [['.', '../shared'], true], '../repository holds no package.json');
});

test('beyond.workspaces adds another version of a member name, inside or outside the root', t => {
	const base = layout(t, 'extension');
	const declaration = Declaration.read(join(base, 'extension/root'));

	assert.deepEqual(
		declaration.members.map(({ id, name, version, source }) => `${id} ${name}@${version} ${source}`),
		[
			'app app@1.0.0 workspaces',
			'libs/message message@1.0.0 beyond.workspaces',
			'../message-v2 message@2.0.0 beyond.workspaces'
		]
	);
	assert.equal(declaration.members[2].path, join(base, 'extension/message-v2'));
	assert.deepEqual([declaration.kind, declaration.valid, codes(declaration)], ['npm', true, []]);
});

test('a standalone package is its own single member, and a directory without one is reported, not thrown', t => {
	const base = layout(t, 'solo', 'empty');
	const declaration = Declaration.read(join(base, 'solo'));
	const [solo] = declaration.members;
	assert.deepEqual([declaration.kind, ids(declaration), solo.source], ['standalone', ['.'], 'standalone']);
	assert.equal(declaration.manifest.name, 'solo');
	assert.equal(declaration.valid, true);

	for (const directory of ['empty', 'absent']) {
		const missing = Declaration.read(join(base, directory));
		assert.deepEqual(
			[missing.kind, ids(missing), codes(missing), missing.valid],
			['standalone', [], ['MEMBER_NOT_FOUND'], false],
			directory
		);
	}
});

test('beyond.json keeps its meaning: literal paths, a directory or its package.json, the root by default', t => {
	const root = join(layout(t, 'classic'), 'classic');
	const declaration = Declaration.read(root);
	assert.deepEqual(
		[declaration.kind, ids(declaration), declaration.manifest],
		['beyond-json', ['app', 'libs/shared'], undefined]
	);
	assert.deepEqual(new Set(declaration.members.map(({ source }) => source)), new Set(['beyond.json']));

	// Paths outside the root, absolute or empty are skipped with a warning, as Packages always did
	edit(join(root, 'beyond.json'), () => ({ packages: ['app', '../outside', '/absolute', '', 'app/package.json'] }));
	const skipped = Declaration.read(root);
	const warnings = Array(3).fill('INVALID_PACKAGE_PATH');
	assert.deepEqual([ids(skipped), codes(skipped), skipped.valid], [['app'], warnings, true]);

	edit(join(root, 'beyond.json'), () => ({}));
	cpSync(join(FIXTURES, 'solo/package.json'), join(root, 'package.json'));
	const single = Declaration.read(root);
	assert.deepEqual([ids(single), single.members[0].name, single.manifest.name], [['.'], 'solo', 'solo']);
});

test('member() is exact, owner() is the deepest member that contains a path, both by real identity', t => {
	const base = layout(t, 'npm', 'globstar', 'outside');
	const npm = Declaration.read(join(base, 'npm'));
	assert.equal(npm.member(join(base, 'npm/packages/alpha')).id, 'packages/alpha');
	assert.equal(npm.member(join(base, 'npm/packages/alpha/src')), undefined);
	assert.equal(npm.owner(join(base, 'npm/packages/alpha/src/deep/file.txt')).id, 'packages/alpha');
	assert.equal(npm.owner(join(base, 'npm/packages/alpha/src/not-yet-written.ts')).id, 'packages/alpha');
	assert.equal(npm.owner(join(base, 'npm/tools/stray')), undefined);
	assert.equal(npm.owner(join(base, 'npm')), undefined, 'the root is not a member unless a pattern names it');

	const globstar = Declaration.read(join(base, 'globstar'));
	assert.equal(globstar.owner(join(base, 'globstar/libs/a/nested/index.ts')).id, 'libs/a/nested');
	assert.equal(globstar.owner(join(base, 'globstar/libs/a/index.ts')).id, 'libs/a');

	const root = join(base, 'outside/root');
	mkdirSync(join(root, 'packages'));
	link(root, 'packages/linked', join('..', '..', 'repository', 'lib'));
	const outside = Declaration.read(root);
	assert.equal(outside.member(join(root, 'packages/linked')).id, 'packages/linked');
	assert.equal(outside.owner(join(base, 'outside/repository/lib/src/file.txt')).id, 'packages/linked');
	assert.equal(outside.owner(join(root, 'packages/linked/src')).id, 'packages/linked');
});
