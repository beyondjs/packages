import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '../context.mjs';
import { Declaration } from '../workspace/declaration.mjs';

/**
 * A `beyond.json` that holds the applications of a workspace beside the members its `package.json` declares, on the
 * `applications` and `solo` fixtures of `fixtures/workspaces` (see their README) copied to a unique temporary directory
 * per case. It declares members only through a non-empty `packages`: without them (absent, `null`, empty) it is no
 * conflict and never decides the kind, which the manifest does; with them it still is a conflict; and one that cannot
 * be read keeps the members the manifest declares.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/workspaces/', import.meta.url));

const layout = (t, fixture = 'applications') => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'beyond declaration applications ')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	cpSync(join(FIXTURES, fixture), join(base, fixture), { recursive: true });
	return join(base, fixture);
};
const edit = (file, change) => writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8'))), null, '\t'));
const ids = declaration => declaration.members.map(({ id }) => id);
const codes = declaration => declaration.diagnostics.map(({ code }) => code);
const read = root => Declaration.read(root);

test('a beyond.json without packages beside npm workspaces leaves the members to the manifest', t => {
	const root = layout(t);
	const declaration = read(root);
	assert.deepEqual(
		[declaration.kind, ids(declaration), codes(declaration), declaration.valid],
		['npm', ['packages/api', 'packages/site'], [], true]
	);
	assert.deepEqual(declaration.members.map(({ source }) => source), ['workspaces', 'workspaces']);

	// The Beyond extension declares members the same way
	edit(join(root, 'package.json'), ({ workspaces, ...manifest }) => ({ ...manifest, beyond: { workspaces } }));
	const extension = read(root);
	assert.deepEqual([extension.kind, ids(extension), codes(extension)], ['npm', ['packages/api', 'packages/site'], []]);
});

test('a beyond.json that declares packages beside npm workspaces is still a conflict, and recovers', t => {
	const root = layout(t);
	const file = join(root, 'beyond.json');

	for (const packages of [['packages/site'], 'packages/site']) {
		edit(file, value => ({ packages, ...value }));
		const declaration = read(root);
		const label = JSON.stringify(packages);
		assert.deepEqual([declaration.kind, ids(declaration), codes(declaration)], ['beyond-json', [], ['WORKSPACE_CONFIG_CONFLICT']], label);
		edit(file, ({ packages, ...value }) => value);
	}

	// Recovery: without packages the manifest names the members again; null or empty packages name none, and are
	// therefore no conflict either
	for (const packages of [undefined, null, '', []]) {
		edit(file, value => ({ ...value, packages }));
		const recovered = read(root);
		assert.deepEqual([recovered.kind, ids(recovered), codes(recovered)], ['npm', ['packages/api', 'packages/site'], []], String(packages));
	}
});

test('a beyond.json that cannot be read beside npm workspaces keeps the members, with a warning, until corrected', t => {
	const root = layout(t);
	const file = join(root, 'beyond.json');
	const original = readFileSync(file, 'utf8');

	for (const content of ['{ "applications": {', '[]', '"applications"']) {
		writeFileSync(file, content);
		const declaration = read(root);
		assert.deepEqual([declaration.kind, ids(declaration), declaration.valid], ['npm', ['packages/api', 'packages/site'], true], content);
		const [warning] = declaration.diagnostics;
		assert.deepEqual([declaration.diagnostics.length, warning.code, warning.severity, warning.paths], [1, 'WORKSPACE_CONFIG_INVALID', 'warning', [file]], content);
	}

	writeFileSync(file, original);
	assert.deepEqual(codes(read(root)), []);
});

test('the applications of beyond.json change no digest of the declaration of an npm root', t => {
	const root = layout(t);
	const before = read(root).inputs;
	edit(join(root, 'beyond.json'), () => ({ applications: { other: { title: 'Other', targets: {} } } }));
	assert.deepEqual(read(root).inputs, before);

	// A root without beyond.json is the same npm workspace
	rmSync(join(root, 'beyond.json'));
	assert.deepEqual(read(root).inputs, before);
});

test('without npm workspaces a beyond.json without packages leaves the package standalone, the root alone', t => {
	const root = layout(t);
	edit(join(root, 'package.json'), ({ workspaces, ...manifest }) => ({ ...manifest, version: '1.0.0' }));
	for (const packages of [undefined, null, []]) {
		edit(join(root, 'beyond.json'), value => ({ ...value, packages }));
		const declaration = read(root);
		assert.deepEqual([declaration.kind, ids(declaration), codes(declaration)], ['standalone', ['.'], []], JSON.stringify(packages));
	}

	// A non-empty packages declares the members, the root among them when it names it
	edit(join(root, 'beyond.json'), value => ({ ...value, packages: ['.'] }));
	assert.deepEqual([read(root).kind, ids(read(root))], ['beyond-json', ['.']]);
});

test('declaring the first application of a standalone package changes neither its kind nor its declaration digest', t => {
	const root = layout(t, 'solo');
	const before = read(root);
	assert.equal(before.kind, 'standalone');
	writeFileSync(join(root, 'beyond.json'), JSON.stringify({ applications: { site: { title: 'Site', targets: {} } } }, null, '\t'));
	const after = read(root);
	assert.deepEqual([after.kind, ids(after), codes(after)], ['standalone', ['.'], []]);
	assert.deepEqual(after.inputs, before.inputs, 'an installed graph made before it is not made stale by it');

	// Its applications in a file of their own, or none yet, are the same declaration
	writeFileSync(join(root, 'beyond.json'), JSON.stringify({ applications: 'applications.json', packages: [] }));
	assert.deepEqual(read(root).inputs, before.inputs);

	// One that cannot be read leaves untold whether it names members: the error of a root that cannot be used
	writeFileSync(join(root, 'beyond.json'), '{ "applications": {');
	const unreadable = read(root);
	assert.deepEqual([unreadable.kind, ids(unreadable), codes(unreadable), unreadable.valid], ['beyond-json', [], ['WORKSPACE_CONFIG_INVALID'], false]);
});

test('a member of an npm root with a beyond.json of applications belongs to that root', t => {
	const root = layout(t);
	const context = new Context({ directory: join(root, 'packages/site') });
	assert.deepEqual([context.root, context.declaration.kind, context.standalone], [root, 'npm', false]);
	assert.equal(context.declaration.owner(context.directory).id, 'packages/site');
});
