/**
 * The parts of dependency management that hold no state of the workspace: the manifest text editor, scopes, changes,
 * the preferences of a plan and the graph's closures, over small inline inputs and the lock fixture of
 * `tests/dependencies`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ManifestText } from '../host/dependencies/text.mjs';
import { Scope } from '../host/dependencies/scope.mjs';
import { Changes } from '../host/dependencies/changes.mjs';
import { Draft } from '../host/dependencies/draft.mjs';
import { Graph } from '../host/dependencies/graph.mjs';

const LOCK = JSON.parse(readFileSync(new URL('../../tests/dependencies/fixtures/locks/workspace.json', import.meta.url), 'utf8'));
const edit = (text, group, name, range) => new ManifestText(text).set(group, name, range).text;

test('a manifest edit changes one value and keeps indentation, order, line endings and every other field', () => {
	const tabs = '{\n\t"name": "x",\n\t"dependencies": {\n\t\t"a": "^1.0.0",\n\t\t"b": "^2.0.0"\n\t}\n}\n';
	assert.equal(edit(tabs, 'dependencies', 'a', '^1.5.0'), '{\n\t"name": "x",\n\t"dependencies": {\n\t\t"a": "^1.5.0",\n\t\t"b": "^2.0.0"\n\t}\n}\n');
	assert.equal(edit(tabs, 'dependencies', 'c', '^3.0.0'), '{\n\t"name": "x",\n\t"dependencies": {\n\t\t"a": "^1.0.0",\n\t\t"b": "^2.0.0",\n\t\t"c": "^3.0.0"\n\t}\n}\n');
	const spaces = '{\r\n  "name": "x",\r\n  "devDependencies": {}\r\n}';
	assert.equal(edit(spaces, 'devDependencies', 'a', '1.0.0'), '{\r\n  "name": "x",\r\n  "devDependencies": {\r\n    "a": "1.0.0"\r\n  }\r\n}');
	assert.equal(edit('{"name":"x"}', 'dependencies', 'a', '^1'), '{"name":"x","dependencies":{\n\t\t"a":"^1"\n\t}}', 'compact text keeps its separators');
	assert.equal(edit('{\n  "scripts": { "x": "a,b" },\n  "name": "y"\n}', 'peerDependencies', 'react', '^19.0.0'), '{\n  "scripts": { "x": "a,b" },\n  "name": "y",\n  "peerDependencies": {\n    "react": "^19.0.0"\n  }\n}');
	const escaped = '{\n\t"description": "a \\"quoted\\" text, with {braces}",\n\t"dependencies": { "a": "^1" }\n}';
	assert.equal(JSON.parse(edit(escaped, 'dependencies', 'a', '^2')).description, 'a "quoted" text, with {braces}');
	assert.equal(new ManifestText(tabs).get('dependencies', 'b'), '^2.0.0');
	for (const text of ['[]', '{"a": 1', '{"dependencies": []}']) {
		assert.throws(() => new ManifestText(text).set('dependencies', 'a', '^1'), SyntaxError, text);
	}
});

test('a scope is the workspace, a member or a node, and anything else is refused', () => {
	assert.deepEqual(Scope.parse(undefined).toJSON(), { kind: 'workspace' });
	assert.deepEqual(Scope.parse('member:apps/web').toJSON(), { kind: 'member', id: 'apps/web' });
	assert.deepEqual(Scope.parse('node:npm:react@19.1.1').toJSON(), { kind: 'node', key: 'npm:react@19.1.1' });
	assert.equal(Scope.parse({ kind: 'member', id: '.' }).text, 'member:.');
	for (const value of ['package:x', 'member:', 'node', 42, ['workspace'], 'x'.repeat(600), 'member:a\u0000b']) {
		assert.throws(() => Scope.parse(value), { code: 'SCOPE_INVALID' }, String(value).slice(0, 40));
	}
	const graph = new Graph(LOCK);
	assert.equal(Scope.parse('member:apps/web').start(graph), 'workspace:apps/web');
	assert.throws(() => Scope.parse('node:npm:none@1.0.0').start(graph), { code: 'SCOPE_NOT_FOUND' });
});

test('changes write to the groups that install a name, a peer range only when nothing else declares it', () => {
	const importers = [
		{ id: 'web', manifest: { dependencies: { react: '^18.3.1' }, devDependencies: { react: '^18.3.1' } } },
		{ id: 'view', manifest: { peerDependencies: { react: '^18.3.1 || ^19.0.0' } } },
		{ id: 'admin', manifest: {} }
	];
	const { writes, pins, released } = new Changes([{ name: 'react', range: '^19.1.0' }, { name: 'left-pad', importer: 'admin', range: '^1.0.0' }, { name: 'scheduler' }, { name: 'shared-lib', importer: 'admin', version: '1.1.0', range: '^1.1.0' }]).resolve([
		...importers.slice(0, 2),
		{ id: 'admin', manifest: { dependencies: { scheduler: '^0.23.0', 'shared-lib': '^1.0.0' } } }
	]);
	assert.deepEqual(writes.map(({ importer, group, name }) => `${importer}:${group}:${name}`), ['web:dependencies:react', 'web:devDependencies:react', 'view:peerDependencies:react', 'admin:dependencies:left-pad', 'admin:dependencies:shared-lib']);
	assert.deepEqual([pins, released], [[{ name: 'shared-lib', version: '1.1.0' }], ['scheduler']]);
	assert.throws(() => new Changes([{ name: 'react', importer: 'admin' }]).resolve(importers), { code: 'CHANGE_UNDECLARED' });
	assert.throws(() => new Changes(Array.from({ length: 51 }, (_, index) => ({ name: `p${index}` }))), { code: 'CHANGES_INVALID' });
});

test('a plan prefers the lock\'s releases, without the names it releases, and with a requested version over a higher locked one', async () => {
	const lock = { present: true, revision: 'sha256-x', document: { nodes: { a: { name: 'react', version: '18.3.1' }, b: { name: 'shared-lib', version: '1.0.0' }, c: { name: 'chart-kit', version: '1.2.0' }, w: { name: '@fixture/web', version: '1.0.0', origin: { provider: 'workspace' } } } } };
	const snapshot = { root: '/ws', lock, importers: [{ id: 'web', manifest: { dependencies: { react: '^18.3.1', 'shared-lib': '^1.0.0', 'chart-kit': '^1.0.0' } } }], declaration: { kind: 'npm', members: [], manifest: {} } };
	const changes = new Changes([{ name: 'shared-lib', version: '1.1.0' }, { name: 'chart-kit', version: '1.0.5' }, { name: 'react' }]);
	const draft = await new Draft(snapshot, changes).compose();
	const pins = draft.preferences().map(({ name, version }) => `${name}@${version}`);
	assert.deepEqual(pins, ['chart-kit@1.0.5', 'shared-lib@1.0.0', 'shared-lib@1.1.0']);
	assert.deepEqual(draft.preferences(['shared-lib']).map(({ name, version }) => `${name}@${version}`), ['chart-kit@1.0.5', 'shared-lib@1.1.0']);
});

test('closures visit a shared node once, and a page leaves out build edges and peers of another context', () => {
	const graph = new Graph(LOCK);
	const dependents = graph.closure('npm:loose-envify@1.4.0', 'in');
	assert.deepEqual([...dependents].sort(), ['npm:loose-envify@1.4.0', 'npm:react-dom@18.3.1', 'npm:react@18.3.1', 'npm:scheduler@0.23.2', 'workspace:apps/admin', 'workspace:apps/web', 'workspace:packages/view', 'npm:chart-kit@1.0.0'].sort());
	assert.ok(graph.page('packages/view').has('npm:react@18.3.1') === false, 'the build edge of a library is not in its page');
	assert.ok(graph.page('apps/web').has('npm:react@18.3.1'));
	assert.equal(Graph.type('build'), 'dev');
	assert.deepEqual(graph.keys('react'), ['npm:react@18.3.1']);
});
