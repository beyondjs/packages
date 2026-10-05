import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Declaration } from '../workspace/declaration.mjs';

/**
 * The inputs of a declaration: the digests a lock and an execution projection record, to tell whether they
 * were built from the current declaration. On the fixtures of `fixtures/workspaces` (see its README), copied
 * to a unique temporary directory for each case.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/workspaces/', import.meta.url));

const layout = (t, ...names) => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'beyond declaration ')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	names.forEach(name => cpSync(join(FIXTURES, name), join(base, name), { recursive: true }));
	return base;
};
const edit = (file, change) => writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8')))));
const change = (file, values) => edit(file, manifest => ({ ...manifest, ...values }));
const digest = text => `sha256-${createHash('sha256').update(text).digest('hex')}`;

/**
 * The same JSON value with the keys of every object in reverse order
 */
const reversed = value => {
	if (Array.isArray(value)) return value.map(reversed);
	if (value === null || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.reverse()
			.map(([key, item]) => [key, reversed(item)])
	);
};

test('the inputs are sha256 digests of the canonical JSON of what the graph depends on', t => {
	const declaration = Declaration.read(join(layout(t, 'solo'), 'solo'));

	// Keys sorted, no whitespace, nothing for absent groups, and the root part for every kind
	const member = '{"dependencies":{"left":"^1.0.0"},"name":"solo","version":"1.0.0"}';
	const members = '[{"id":".","name":"solo","version":"1.0.0"}]';
	const document = `{"kind":"standalone","members":${members},"root":{"dependencies":{"left":"^1.0.0"}}}`;
	assert.deepEqual(declaration.inputs, { declaration: digest(document), members: { '.': digest(member) } });
	assert.ok(Object.isFrozen(declaration.inputs) && Object.isFrozen(declaration.inputs.members));
});

test('every member has a digest, keyed by its id', t => {
	const { inputs } = Declaration.read(join(layout(t, 'npm'), 'npm'));
	const digests = [inputs.declaration, ...Object.values(inputs.members)];

	const ids = ['apps/web', 'packages/alpha', 'packages/beta'];
	assert.deepEqual(Object.keys(inputs.members), ids, 'in code unit order');
	digests.forEach(value => assert.match(value, /^sha256-[0-9a-f]{64}$/));
	assert.equal(new Set(Object.values(inputs.members)).size, 3);
});

test('reordered keys and patterns change no digest', t => {
	const base = layout(t, 'npm');
	const manifests = ['.', 'packages/alpha', 'packages/beta', 'apps/web'].map(member => join(member, 'package.json'));
	cpSync(join(base, 'npm'), join(base, 'reordered'), { recursive: true });
	manifests.forEach(file => edit(join(base, 'reordered', file), reversed));
	const { workspaces } = JSON.parse(readFileSync(join(base, 'npm/package.json'), 'utf8'));
	change(join(base, 'reordered/package.json'), { workspaces: workspaces.toReversed() });

	const original = Declaration.read(join(base, 'npm'));
	const reordered = Declaration.read(join(base, 'reordered'));
	const order = declaration => declaration.members.map(({ id }) => id);
	assert.notDeepEqual(order(reordered), order(original), 'the members are in another declaration order');
	assert.deepEqual(reordered.inputs, original.inputs);
});

test('a dependency changes the digest of its member, and the root dependencies the declaration digest', t => {
	const root = join(layout(t, 'npm'), 'npm');
	const alpha = join(root, 'packages/alpha/package.json');
	const { dependencies } = JSON.parse(readFileSync(alpha, 'utf8'));
	const before = Declaration.read(root).inputs;

	// What differs from the digests read before any edit
	const changes = () => {
		const { declaration, members } = Declaration.read(root).inputs;
		const changed = Object.keys(members).filter(id => members[id] !== before.members[id]);
		return { declaration: declaration !== before.declaration, members: changed };
	};

	change(alpha, { dependencies: { ...dependencies, right: '^2.1.0' } });
	assert.deepEqual(changes(), { declaration: false, members: ['packages/alpha'] });
	change(alpha, { dependencies });
	assert.deepEqual(Declaration.read(root).inputs, before, 'restoring the dependency restores the digest');

	change(alpha, { peerDependenciesMeta: { react: { optional: true } } });
	assert.deepEqual(changes(), { declaration: false, members: ['packages/alpha'] });

	change(join(root, 'packages/beta/package.json'), { version: '2.2.0' });
	assert.deepEqual(changes(), { declaration: true, members: ['packages/alpha', 'packages/beta'] });

	// The overrides of the root manifest change the declaration and no member
	const previous = Declaration.read(root).inputs;
	change(join(root, 'package.json'), { overrides: { left: '1.0.2' } });
	const overridden = Declaration.read(root).inputs;
	assert.notEqual(overridden.declaration, previous.declaration);
	assert.deepEqual(overridden.members, previous.members);
});

test('the overrides of a standalone package change the declaration digest, which the graph applies', t => {
	const solo = join(layout(t, 'solo'), 'solo');
	const manifest = join(solo, 'package.json');
	const before = Declaration.read(solo).inputs;

	change(manifest, { overrides: { left: '1.0.1' } });
	const overridden = Declaration.read(solo).inputs;
	assert.notEqual(overridden.declaration, before.declaration);
	assert.deepEqual(overridden.members, before.members, 'overrides are in no member digest');

	// Recovery: without them, the digests of before
	edit(manifest, ({ overrides, ...rest }) => rest);
	assert.deepEqual(Declaration.read(solo).inputs, before);
});

test('fields the graph does not depend on change no digest', t => {
	const root = join(layout(t, 'npm'), 'npm');
	const before = Declaration.read(root).inputs;

	const exports = { './main': './main/index.ts' };
	change(join(root, 'packages/alpha/package.json'), { description: 'Changed', exports });
	change(join(root, 'packages/beta/package.json'), { private: true, scripts: { test: 'node --test' } });
	change(join(root, 'package.json'), { description: 'Changed', scripts: { build: 'beyond install' } });
	assert.deepEqual(Declaration.read(root).inputs, before);
});

test('the root manifest of a beyond.json workspace takes part through its dependency groups only', t => {
	const root = join(layout(t, 'classic'), 'classic');
	const manifest = join(root, 'package.json');
	const bare = Declaration.read(root).inputs;

	writeFileSync(manifest, JSON.stringify({ name: 'classic-root', description: 'No dependency groups' }));
	assert.deepEqual(Declaration.read(root).inputs, bare, 'a root manifest without dependency groups adds nothing');

	writeFileSync(manifest, JSON.stringify({ name: 'classic-root', devDependencies: { left: '^1.0.0' } }));
	const grouped = Declaration.read(root).inputs;
	assert.notEqual(grouped.declaration, bare.declaration);
	assert.deepEqual(grouped.members, bare.members);

	// The graph reads which peers of the root importer are optional
	const peers = { peerDependencies: { left: '^1.0.0' } };
	writeFileSync(manifest, JSON.stringify({ name: 'classic-root', ...peers }));
	const required = Declaration.read(root).inputs;
	const meta = { peerDependenciesMeta: { left: { optional: true } } };
	writeFileSync(manifest, JSON.stringify({ name: 'classic-root', ...peers, ...meta }));
	const optional = Declaration.read(root).inputs;
	assert.notEqual(optional.declaration, required.declaration, 'peerDependenciesMeta of the root takes part');
	assert.deepEqual(optional.members, required.members);
});
