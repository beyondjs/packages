import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Declaration } from '../workspace/declaration.mjs';

/**
 * What a declaration reports, by code, on the fixtures of `fixtures/workspaces` (see its README) copied to a
 * unique temporary directory for each case. Reading never throws for what the files contain.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/workspaces/', import.meta.url));

const layout = (t, ...names) => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'beyond declaration ')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	names.forEach(name => cpSync(join(FIXTURES, name), join(base, name), { recursive: true }));
	return base;
};
const edit = (file, change) => writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8')))));
const ids = declaration => declaration.members.map(({ id }) => id);
const codes = declaration => declaration.diagnostics.map(({ code }) => code);
const found = (declaration, code) => declaration.diagnostics.find(diagnostic => diagnostic.code === code);

/**
 * Replaces the members the root manifest declares: `workspaces`, and `beyond.workspaces` when given
 */
const redeclare = (root, workspaces, extension) =>
	edit(join(root, 'package.json'), ({ beyond, ...manifest }) => ({
		...manifest,
		workspaces,
		...(extension ? { beyond: { workspaces: extension } } : {})
	}));

test('beyond.json and package.json members together are a conflict, never merged', t => {
	const root = join(layout(t, 'conflict'), 'conflict');
	const declaration = Declaration.read(root);
	assert.deepEqual(
		[declaration.kind, ids(declaration), codes(declaration), declaration.valid],
		['beyond-json', [], ['WORKSPACE_CONFIG_CONFLICT'], false]
	);
	const conflict = found(declaration, 'WORKSPACE_CONFIG_CONFLICT');
	const files = [join(root, 'beyond.json'), join(root, 'package.json')];
	assert.deepEqual([conflict.severity, conflict.paths], ['error', files]);

	// Recovery: once one of them is gone, the other declares the members
	edit(join(root, 'package.json'), ({ workspaces, ...manifest }) => manifest);
	const recovered = Declaration.read(root);
	assert.deepEqual([recovered.kind, ids(recovered), recovered.valid], ['beyond-json', ['app'], true]);
});

test('a configuration that is not what npm or Beyond expects is invalid', t => {
	const root = join(layout(t, 'npm'), 'npm');
	const original = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const configurations = [
		{ workspaces: 'packages/*' },
		{ workspaces: { packages: 'packages/*' } },
		{ workspaces: null },
		{ workspaces: ['packages/*', 42] },
		{ workspaces: ['packages/*', ''] },
		{ beyond: { workspaces: { path: 'apps/web' } } },
		{ beyond: { workspaces: [{ version: '0.1.0' }] } },
		{ beyond: { workspaces: [['apps/web']] } },
		{ beyond: { workspaces: [{ path: 'apps/web', version: 1 }] } },
		{ beyond: { workspaces: [{ path: 'apps/web', version: 'v0.1.0' }] } }
	];

	for (const configuration of configurations) {
		writeFileSync(join(root, 'package.json'), JSON.stringify({ ...original, ...configuration }));
		const declaration = Declaration.read(root);
		const label = JSON.stringify(configuration);
		assert.deepEqual(codes(declaration), ['WORKSPACE_CONFIG_INVALID'], label);
		assert.equal(declaration.valid, false, label);
	}

	// What can be read is still read: the members of the valid patterns are listed
	redeclare(root, ['packages/*', 42]);
	assert.deepEqual(ids(Declaration.read(root)), ['packages/alpha', 'packages/beta']);
});

test('a beyond.json that cannot be read, or whose packages are not a list, is invalid', t => {
	const root = join(layout(t, 'classic'), 'classic');
	const contents = [JSON.stringify({ packages: 'app' }), JSON.stringify(['app']), '{ "packages": ['];
	for (const content of contents) {
		writeFileSync(join(root, 'beyond.json'), content);
		const declaration = Declaration.read(root);
		assert.deepEqual([codes(declaration), ids(declaration)], [['WORKSPACE_CONFIG_INVALID'], []], content);
	}

	// The root manifest of a workspace holds dependencies of the graph even when the root is not a member
	writeFileSync(join(root, 'beyond.json'), JSON.stringify({ packages: ['app'] }));
	writeFileSync(join(root, 'package.json'), '{ "dependencies": ');
	const unreadable = Declaration.read(root);
	assert.deepEqual([codes(unreadable), ids(unreadable)], [['WORKSPACE_CONFIG_INVALID'], ['app']]);
	assert.deepEqual(found(unreadable, 'WORKSPACE_CONFIG_INVALID').paths, [join(root, 'package.json')]);
});

test('a root manifest that cannot be read is a configuration error, and a member error when the root is one', t => {
	const base = layout(t, 'solo', 'classic');
	const solo = join(base, 'solo');
	writeFileSync(join(solo, 'package.json'), '{ "name": "solo", ');

	// The kind is decided by what exists: a package.json alone is a standalone package
	const standalone = Declaration.read(solo);
	assert.deepEqual(
		[standalone.kind, ids(standalone), codes(standalone)],
		['standalone', ['.'], ['WORKSPACE_CONFIG_INVALID', 'MEMBER_MANIFEST_INVALID']]
	);
	assert.deepEqual(found(standalone, 'WORKSPACE_CONFIG_INVALID').paths, [join(solo, 'package.json')]);

	// The root of a beyond.json workspace is its only member by default
	writeFileSync(join(base, 'classic/beyond.json'), '{}');
	writeFileSync(join(base, 'classic/package.json'), '{ "dependencies": ');
	const classic = Declaration.read(join(base, 'classic'));
	assert.deepEqual(
		[classic.kind, ids(classic), codes(classic)],
		['beyond-json', ['.'], ['WORKSPACE_CONFIG_INVALID', 'MEMBER_MANIFEST_INVALID']]
	);

	// Recovery: the manifest of the fixture again
	cpSync(join(FIXTURES, 'solo/package.json'), join(solo, 'package.json'));
	assert.equal(Declaration.read(solo).valid, true);
});

test('a directory named exactly must exist and hold a package.json', t => {
	const base = layout(t, 'extension', 'classic');
	const root = join(base, 'extension/root');
	redeclare(root, ['app'], [{ path: '../message-v9' }, { path: 'libs' }]);
	const declaration = Declaration.read(root);
	assert.deepEqual(codes(declaration), ['MEMBER_NOT_FOUND', 'MEMBER_NOT_FOUND']);
	assert.deepEqual(found(declaration, 'MEMBER_NOT_FOUND').paths, [join(base, 'extension/message-v9')]);
	assert.deepEqual(ids(declaration), ['app']);

	edit(join(base, 'classic/beyond.json'), () => ({ packages: ['app', 'ghost'] }));
	assert.deepEqual(codes(Declaration.read(join(base, 'classic'))), ['MEMBER_NOT_FOUND']);
});

test('an absolute {path} in beyond.workspaces is refused, never taken as relative to the root', t => {
	const base = layout(t, 'extension');
	const root = join(base, 'extension/root');
	const absolute = join(base, 'extension/message-v2');

	redeclare(root, ['app'], ['libs/*', { path: absolute, version: '2.0.0' }]);
	const declaration = Declaration.read(root);
	assert.deepEqual([codes(declaration), ids(declaration)], [['WORKSPACE_CONFIG_INVALID'], ['app', 'libs/message']]);
	const { message } = found(declaration, 'WORKSPACE_CONFIG_INVALID');
	assert.ok(message.includes(`"${absolute}"`), 'the path is named as it was written');
	assert.match(message, /"\.\.\/message-v2"/);

	// Recovery: the same directory, relative to the root
	redeclare(root, ['app'], ['libs/*', { path: '../message-v2', version: '2.0.0' }]);
	const relative = Declaration.read(root);
	assert.deepEqual([relative.valid, ids(relative)], [true, ['app', 'libs/message', '../message-v2']]);
});

test('a version that a declaration asserts is checked against the manifest, which is authoritative', t => {
	const root = join(layout(t, 'extension'), 'extension/root');

	redeclare(root, ['app'], ['libs/*', { path: '../message-v2', version: '2.1.0' }]);
	const declaration = Declaration.read(root);
	assert.deepEqual(codes(declaration), ['MEMBER_VERSION_MISMATCH']);
	const member = declaration.member(join(root, '../message-v2'));
	assert.equal(member.version, '2.0.0', 'the member keeps the version of its manifest');

	redeclare(root, ['app'], ['libs/*', { path: '../message-v2', version: '2.0.0' }]);
	assert.equal(Declaration.read(root).valid, true);
});

test('one name with two versions inside npm workspaces is refused, as npm refuses it', t => {
	const base = layout(t, 'extension');
	const root = join(base, 'extension/root');
	redeclare(root, ['app', 'libs/*', '../message-v2']);

	const declaration = Declaration.read(root);
	const duplicated = found(declaration, 'WORKSPACE_NAME_DUPLICATED');
	assert.deepEqual(codes(declaration), ['WORKSPACE_NAME_DUPLICATED']);
	assert.deepEqual(duplicated.paths, [join(root, 'libs/message'), join(base, 'extension/message-v2')]);
	assert.match(duplicated.message, /beyond\.workspaces/);
});

test('one release at two directories is refused wherever it is declared', t => {
	const root = join(layout(t, 'extension'), 'extension/root');
	const paths = [join(root, 'libs/message'), join(root, 'vendor/message')];

	redeclare(root, ['app'], ['libs/*', 'vendor/*']);
	const extension = Declaration.read(root);
	assert.deepEqual(codes(extension), ['WORKSPACE_INSTANCE_DUPLICATED']);
	assert.deepEqual(found(extension, 'WORKSPACE_INSTANCE_DUPLICATED').paths, paths);

	// Inside npm workspaces, the same release twice is also one name twice, which npm refuses on its own
	redeclare(root, ['app', 'libs/*', 'vendor/*']);
	const npm = Declaration.read(root);
	assert.deepEqual(codes(npm), ['WORKSPACE_INSTANCE_DUPLICATED', 'WORKSPACE_NAME_DUPLICATED']);
	assert.deepEqual(found(npm, 'WORKSPACE_NAME_DUPLICATED').paths, paths);

	// Recovery: one copy left, nothing to report
	redeclare(root, ['app', 'libs/*']);
	assert.equal(Declaration.read(root).valid, true);
});

test('a member needs a string name and a version in canonical semver form', t => {
	const root = join(layout(t, 'npm'), 'npm');
	const file = join(root, 'packages/beta/package.json');
	const original = readFileSync(file, 'utf8');
	const manifests = [
		JSON.stringify({ name: '@fixture/beta' }),
		JSON.stringify({ name: '@fixture/beta', version: 'v2.1.0' }),
		JSON.stringify({ name: '@fixture/beta', version: '2.1.0+build.5' }),
		JSON.stringify({ name: '@fixture/beta', version: 'latest' }),
		JSON.stringify({ name: 42, version: '2.1.0' }),
		JSON.stringify({ name: '', version: '2.1.0' }),
		JSON.stringify(['@fixture/beta', '2.1.0']),
		'{ "name": "@fixture/beta", '
	];

	for (const manifest of manifests) {
		writeFileSync(file, manifest);
		const declaration = Declaration.read(root);
		assert.deepEqual(codes(declaration), ['MEMBER_MANIFEST_INVALID'], manifest);
		assert.deepEqual(found(declaration, 'MEMBER_MANIFEST_INVALID').paths, [file], manifest);
		assert.deepEqual(ids(declaration), ['packages/alpha', 'packages/beta', 'apps/web'], 'the member stays listed');
	}

	writeFileSync(file, original);
	assert.equal(Declaration.read(root).valid, true);
});

test('a pattern that matches no package is a warning, and the declaration stays valid', t => {
	const root = join(layout(t, 'npm'), 'npm');
	redeclare(root, ['packages/*', 'missing/*', 'packages/notes', 'apps/web']);

	const declaration = Declaration.read(root);
	assert.deepEqual(codes(declaration), ['WORKSPACE_PATTERN_EMPTY', 'WORKSPACE_PATTERN_EMPTY']);
	assert.deepEqual(
		declaration.diagnostics.map(({ severity, message }) => [severity, message.split('"')[1]]),
		[
			['warning', 'missing/*'],
			['warning', 'packages/notes']
		]
	);
	assert.deepEqual([ids(declaration), declaration.valid], [['packages/alpha', 'packages/beta', 'apps/web'], true]);
});
