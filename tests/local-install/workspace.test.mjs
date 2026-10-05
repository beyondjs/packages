/**
 * How Packages consumes a workspace with and without the execution projection of its installed graph
 * (`@beyond-js/packages/workspace` and `@beyond-js/packages/artifacts`): members by id at their own
 * directories, one outside the root; several versions of one name as instances that only a version or the
 * graph tells apart; each importer reaching what its edges select, a root override and an alias included;
 * canonical paths; installed packages compiled from the store; and resources by version. The types are
 * `workspace-types.test.mjs`. The fixtures are `fixtures/workspace` (see its README); the harness is
 * `support/workspace.mjs`.
 *
 * ```sh
 * # BEE_URL and BEE_NODE_DIR: the bootstrap Engine serving this checkout and the loader (tests/stage-1/README.md)
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/workspace.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { Selection } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { FIXTURE, IDS, NODE, BROWSER, BOUND, codes, prepare, open } from './support/workspace.mjs';

const by = (delivered, specifier) => delivered.dependencies.find(one => one.specifier === specifier);
const versions = /1\.0\.0 \(message-v1\), 2\.0\.0 \(\.\.\/outside\/message-v2\)/;

test('members: each member is a package at its own directory, one outside the root, instead of beyond.json', BOUND, async t => {
	const { root, directory, members } = await prepare(t);
	const workspace = await open(t, root, { members: [...members(IDS), { id: 'relative', path: 'relative/path' }] });

	assert.deepEqual([...workspace.packages.keys()], IDS);
	const outside = workspace.packages.get('../outside/message-v2');
	assert.deepEqual([outside.path, outside.vname], [directory('../outside/message-v2'), '@fixture/message@2.0.0']);
	assert.deepEqual(workspace.errors, []);
	assert.deepEqual(codes(workspace.warnings), ['INVALID_PACKAGE_PATH'], 'a member needs an absolute path');
	assert.equal(workspace.execution, undefined);

	// Without members the workspace is read from its beyond.json, which this npm workspace does not have
	assert.equal((await open(t, root, {})).valid, false);
	// An empty "packages" of a beyond.json declares the default, the root package; another value is refused
	for (const [packages, keys, errors] of [[null, ['.'], []], ['', ['.'], []], [7, [], ['INVALID_PACKAGES_PROPERTY']]]) {
		await writeFile(join(root, 'beyond.json'), JSON.stringify({ packages }));
		const configured = await open(t, root, {});
		assert.deepEqual([[...configured.packages.keys()], codes(configured.errors)], [keys, errors], `packages: ${JSON.stringify(packages)}`);
	}
});

test('resolve: with an execution, each importer reaches the instance its edges select', BOUND, async t => {
	const { root, members, location, execution } = await prepare(t);
	const workspace = await open(t, root, { members: members(IDS), execution: execution() });
	const [one, two] = ['app-v1', 'app-v2'].map(id => workspace.packages.get(id));
	assert.ok(workspace.execution, 'the execution given is the one the workspace exposes');

	const first = workspace.resolve('@fixture/message/main', one);
	assert.deepEqual([first.package, first.subpath, first.node], [workspace.packages.get('message-v1'), './main', 'workspace:message-v1']);
	const second = workspace.resolve('@fixture/message/main', two);
	assert.deepEqual([second.package, second.node], [workspace.packages.get('../outside/message-v2'), 'workspace:../outside/message-v2']);

	// An external package is a node with the location of its sources, and no package of the workspace
	const greeting = workspace.imports.resolve('greeting', two);
	assert.deepEqual([greeting.package, greeting.key, greeting.node.location], [undefined, 'npm:greeting@2.0.0', location('npm:greeting@2.0.0')]);
	assert.equal(workspace.resolve('greeting', two), undefined);

	// A name without an edge is not installed, a package resolves its own name to itself, a subpath import is
	// no package, and nothing is resolved by name without the importer whose edges decide
	assert.equal(workspace.imports.resolve('left-pad', one).error.code, 'DEPENDENCY_NOT_INSTALLED');
	const own = workspace.resolve('@fixture/app-v1/typed', one);
	assert.deepEqual([own.package, own.node], [one, 'workspace:app-v1']);
	assert.equal(workspace.imports.resolve('#internal/x', one), undefined);
	assert.equal(workspace.imports.resolve('@fixture/message/main').error.code, 'IMPORTER_REQUIRED');
	assert.equal(workspace.resolve('@fixture/app-v1/main'), undefined);

	// An edge to a member the workspace no longer has, an importer the graph does not know, and a member whose
	// directory holds another release than the graph recorded
	const changed = await open(t, root, { members: members(['app-v1', 'app-v2', '../outside/message-v2', 'message-copy']), execution: execution() });
	const stale = changed.imports.resolve('@fixture/message/main', changed.packages.get('app-v1'));
	assert.deepEqual([stale.error.code, stale.key], ['EXECUTION_GRAPH_STALE', 'workspace:message-v1']);
	assert.equal(changed.imports.resolve('greeting', changed.packages.get('message-copy')).error.code, 'DEPENDENCY_NOT_INSTALLED');
	const other = execution(document => {
		document.nodes['workspace:message-v1'].version = '1.5.0';
		return document;
	});
	const replaced = new Delivery(await open(t, root, { members: members(IDS), execution: other }));
	const main = await replaced.module({ name: '@fixture/app-v1', version: '1.0.0', subpath: './main' }, NODE);
	assert.deepEqual(codes(main.failure?.diagnostics), ['EXECUTION_GRAPH_STALE']);
});

test('resolve: without an execution, a name several packages hold is an error and never the first', BOUND, async t => {
	const { root, members } = await prepare(t);
	const workspace = await open(t, root, { members: members(IDS) });
	const ambiguous = workspace.imports.resolve('@fixture/message/main', workspace.packages.get('app-v1'));
	assert.equal(ambiguous.error.code, 'PACKAGE_AMBIGUOUS');
	assert.match(ambiguous.error.message, versions);
	assert.equal(workspace.resolve('@fixture/message/main', workspace.packages.get('app-v1')), undefined);

	const copies = await open(t, root, { members: members(['app-v1', 'message-v1', 'message-copy']) });
	assert.equal(copies.imports.resolve('@fixture/message/main', copies.packages.get('app-v1')).error.code, 'PACKAGE_DUPLICATED');

	// One package of the name is resolved by name, as before, with or without an importer
	const single = await open(t, root, { members: members(['app-v1', 'message-v1']) });
	const found = single.resolve('@fixture/message/main', single.packages.get('app-v1'));
	assert.deepEqual([found.package, found.node], [single.packages.get('message-v1'), void 0]);
	assert.equal(single.resolve('@fixture/message/main').package, single.packages.get('message-v1'));
});

test('selection: versions are instances, a versioned selector picks one and one version twice is duplicated', BOUND, async t => {
	const { root, directory, members } = await prepare(t);
	const selection = new Selection(await open(t, root, { members: members(IDS) }));
	const selected = async (input, from) => {
		const { selected, errors } = await selection.resolve(input, from);
		return selected ?? errors[0];
	};

	assert.deepEqual(await selection.duplicates(), [], 'two versions of one name are not duplicates');
	const ambiguous = await selected('@fixture/message/main');
	assert.equal(ambiguous.code, 'PACKAGE_AMBIGUOUS');
	assert.match(ambiguous.message, versions);

	const second = await selected('@fixture/message@2.0.0/main');
	assert.deepEqual([second.package.path, second.vspecifier], [directory('../outside/message-v2'), '@fixture/message@2.0.0/main']);
	assert.equal((await selected('@fixture/message@1.0.0/main')).package.path, directory('message-v1'));
	const mismatch = await selected('@fixture/message@3.0.0/main');
	assert.equal(mismatch.code, 'VERSION_MISMATCH');
	assert.match(mismatch.message, /@fixture\/message@1\.0\.0, @fixture\/message@2\.0\.0/);
	assert.equal((await selected('./main', directory('../outside/message-v2'))).vspecifier, '@fixture/message@2.0.0/main');

	const copies = new Selection(await open(t, root, { members: members([...IDS, 'message-copy']) }));
	const duplicates = await copies.duplicates();
	assert.deepEqual(codes(duplicates), ['PACKAGE_DUPLICATED']);
	assert.match(duplicates[0].message, /"@fixture\/message@1\.0\.0" is declared by more than one workspace package: message-v1, message-copy$/);
	assert.equal((await copies.resolve('@fixture/app-v1/main')).errors[0].code, 'PACKAGE_DUPLICATED');
});

test('canonical paths: members and the store reached through symbolic links are the nodes they link to', BOUND, async t => {
	const { root, directory, members, location, execution } = await prepare(t, { store: 'link' });
	const workspace = await open(t, root, { members: members(IDS, true), execution: execution() });
	const delivery = new Delivery(workspace);
	const one = workspace.packages.get('app-v1');
	assert.equal(one.path, directory('app-v1', true), 'the member is read from the directory given');

	const message = workspace.resolve('@fixture/message/main', one);
	assert.deepEqual([message.package, message.node], [workspace.packages.get('message-v1'), 'workspace:message-v1']);
	const main = await delivery.module({ name: '@fixture/app-v1', version: '1.0.0', subpath: './main' }, NODE);
	assert.equal(main.failure, undefined, JSON.stringify(main.failure));
	assert.equal(by(main.delivered, 'kit').node, 'npm:kit@1.0.0');
	const published = (await delivery.published()).find(one => one.specifier === '@fixture/message/main' && one.version === '1.0.0');
	assert.equal(published.node, 'workspace:message-v1');

	// The store is located at its real path, and its packages compile from there
	const kit = delivery.installed.locate('kit', '1.0.0');
	assert.notEqual(kit, location('npm:kit@1.0.0'), 'the projection names the link');
	assert.ok(kit.startsWith(join(root, '..', 'store')), kit);
	assert.equal((await delivery.module({ name: 'kit', version: '1.0.0', subpath: '.' }, BROWSER)).failure, undefined);
});

test('dependencies: the importer edges classify workspace, external and missing dependencies', BOUND, async t => {
	const { root, members, location, execution } = await prepare(t);
	const delivery = new Delivery(await open(t, root, { members: members(IDS), execution: execution() }));
	assert.ok(delivery.execution);
	const module = (name, subpath) => delivery.module({ name, version: '1.0.0', subpath }, NODE);

	const one = await module('@fixture/app-v1', './main');
	assert.equal(one.failure, undefined, JSON.stringify(one.failure));
	const message = { specifier: '@fixture/message/main', source: 'workspace', vspecifier: '@fixture/message@1.0.0/main', range: '^1.0.0', node: 'workspace:message-v1' };
	assert.deepEqual(by(one.delivered, '@fixture/message/main'), message);
	const greeting = { specifier: 'greeting', source: 'external', node: 'npm:greeting@1.0.0', version: '1.0.0', location: location('npm:greeting@1.0.0') };
	assert.deepEqual(by(one.delivered, 'greeting'), greeting);

	const two = await module('@fixture/app-v2', './main');
	assert.deepEqual([by(two.delivered, '@fixture/message/main').vspecifier, by(two.delivered, 'greeting').version], ['@fixture/message@2.0.0/main', '2.0.0']);
	const missing = await module('@fixture/app-v1', './missing');
	assert.deepEqual([missing.failure.code, codes(missing.failure.diagnostics)], ['BUILD_FAILED', ['DEPENDENCY_NOT_INSTALLED']]);
	const published = (await delivery.published()).find(one => one.specifier === '@fixture/message/main' && one.version === '2.0.0');
	assert.equal(published.node, 'workspace:../outside/message-v2');

	// Without an execution, a dependency the workspace does not provide is left to the environment, as before
	const legacy = new Delivery(await open(t, root, { members: members(['app-v1', 'message-v1']) }));
	const before = await legacy.module({ name: '@fixture/app-v1', version: '1.0.0', subpath: './main' }, NODE);
	assert.deepEqual(by(before.delivered, 'greeting'), { specifier: 'greeting', source: 'external' });
	const { node, ...unnoded } = message;
	assert.deepEqual(by(before.delivered, '@fixture/message/main'), unnoded, `no node without an execution (${node})`);
});

test('dependencies: a member a root override selected answers to the override, an alias to its own name', BOUND, async t => {
	const { root, members, execution } = await prepare(t);
	const built = async (name, subpath, change) => new Delivery(await open(t, root, { members: members(IDS), execution: execution(change) })).module({ name, version: '1.0.0', subpath }, NODE);
	// The edge of app-pinned without the selection the lock recorded, or with another one
	const edge = selection => document => {
		const found = document.edges.find(one => one.from === 'workspace:app-pinned');
		selection === void 0 ? delete found.override : (found.override = selection);
		return document;
	};

	const pinned = await built('@fixture/app-pinned', './main');
	assert.equal(pinned.failure, undefined, JSON.stringify(pinned.failure));
	const expected = { source: 'workspace', vspecifier: '@fixture/message@2.0.0/main', range: '^1.0.0', override: '2.0.0', node: 'workspace:../outside/message-v2' };
	assert.deepEqual(by(pinned.delivered, '@fixture/message/main'), { specifier: '@fixture/message/main', ...expected });

	// Without the override the declared range decides; an override the member does not satisfy is refused
	for (const [change, pattern] of [[edge(), /requires "@fixture\/message@\^1\.0\.0" but/], [edge('^3.0.0'), /"@fixture\/message@\^3\.0\.0" \(a root override of "\^1\.0\.0"\)/]]) {
		const { failure } = await built('@fixture/app-pinned', './main', change);
		assert.deepEqual(codes(failure?.diagnostics), ['DEPENDENCY_INCOMPATIBLE']);
		assert.match(failure.diagnostics[0].message, pattern);
	}

	// One module of app-v1 imports the first version by its name and the second by an alias
	const alias = await built('@fixture/app-v1', './alias');
	assert.equal(alias.failure, undefined, JSON.stringify(alias.failure));
	assert.equal(by(alias.delivered, '@fixture/message/main').vspecifier, '@fixture/message@1.0.0/main');
	assert.deepEqual(by(alias.delivered, 'message-two/main'), { specifier: 'message-two/main', source: 'workspace', vspecifier: '@fixture/message@2.0.0/main', range: 'workspace:../outside/message-v2', node: 'workspace:../outside/message-v2' });
});

test('installed: a store package is compiled from the location of its node, and nothing else is looked for', BOUND, async t => {
	const { base, root, members, location, execution } = await prepare(t);
	const delivery = new Delivery(await open(t, root, { members: members(IDS), execution: execution() }));
	const { installed } = delivery;

	const { delivered, failure } = await delivery.module({ name: 'greeting', version: '2.0.0', subpath: '.' }, BROWSER);
	assert.equal(failure, undefined, JSON.stringify(failure));
	assert.equal(delivered.key, 'installed');
	assert.match(delivered.code('none'), /Hello from greeting/);
	assert.equal(installed.locate('greeting', '1.0.0'), location('npm:greeting@1.0.0'));
	const request = { name: 'greeting', version: '1.0.0', subpath: '.' };
	const compiled = installed.module(request, BROWSER);
	assert.equal(installed.module({ ...request, key: 'npm:greeting@1.0.0' }, BROWSER), compiled, 'one node, one compilation');
	assert.equal((await compiled).failure, undefined);

	// The toolchain's installation is not an installation of the workspace, unlike without an execution
	const typescript = createRequire(join(process.cwd(), 'package.json'))('typescript/package.json').version;
	assert.equal(installed.locate('typescript', typescript), undefined);
	assert.equal((await delivery.module({ name: 'typescript', version: typescript, subpath: '.' }, BROWSER)).failure.code, 'PACKAGE_NOT_FOUND');
	const legacy = new Delivery(await open(t, root, { members: members(IDS) }));
	assert.ok(legacy.installed.locate('typescript', typescript), 'without an execution the working directory is searched');

	// The registry copy of a member's name, which an alias reaches, is served at its version; never without the graph
	const registry = { name: '@fixture/message', version: '3.0.0', subpath: './main' };
	assert.match((await delivery.module(registry, BROWSER)).delivered.code('none'), /from the registry/);
	assert.equal((await legacy.module(registry, BROWSER)).failure.code, 'VERSION_MISMATCH');

	// One name and version two nodes claim cannot be told apart
	const twice = execution(document => {
		document.nodes['registry-mirror:greeting@1.0.0'] = { ...document.nodes['npm:greeting@1.0.0'] };
		return document;
	});
	const conflict = await new Delivery(await open(t, root, { members: members(IDS), execution: twice })).module(request, BROWSER);
	assert.deepEqual([conflict.failure.code, codes(conflict.failure.diagnostics)], ['BUILD_FAILED', ['INSTANCE_NAME_CONFLICT']]);

	// A version the graph does not have is not found, and a node whose sources are gone says so
	assert.equal((await delivery.module({ ...request, version: '3.0.0' }, BROWSER)).failure.code, 'PACKAGE_NOT_FOUND');
	const plain = { name: 'plain', version: '1.0.0', subpath: '.' };
	const sources = location('npm:plain@1.0.0');
	await rm(sources, { recursive: true });
	const gone = await delivery.module(plain, BROWSER);
	assert.deepEqual([gone.failure.code, codes(gone.failure.diagnostics)], ['BUILD_FAILED', ['SOURCE_MISSING']]);

	// Once the sources are back (a new install), the same service compiles them: the failure was not kept
	await cp(join(FIXTURE, relative(base, sources)), sources, { recursive: true });
	const back = await delivery.module(plain, BROWSER);
	assert.equal(back.failure, undefined, JSON.stringify(back.failure));
	assert.match(back.delivered.code('none'), /"plain"/);
});

test('resources: a stylesheet and an asset are read from the instance of the version requested', BOUND, async t => {
	const { root, members, execution } = await prepare(t);
	const { resources } = new Delivery(await open(t, root, { members: members(IDS), execution: execution() }));
	const asset = version => resources.asset({ name: '@fixture/message', version, path: 'notice.txt' });
	const theme = version => resources.styles({ name: '@fixture/message', version, subpath: './theme' }, BROWSER);

	assert.deepEqual([String((await asset('1.0.0')).content), String((await asset('2.0.0')).content)], ['notice v1\n', 'notice v2\n']);
	assert.match((await theme('1.0.0')).styles.code(), /red/);
	assert.match((await theme('2.0.0')).styles.code(), /blue/);
	assert.equal((await asset('3.0.0')).failure.code, 'VERSION_MISMATCH');

	// One version at two directories is not answered with either
	const copies = new Delivery(await open(t, root, { members: members([...IDS, 'message-copy']) }));
	const duplicated = await copies.resources.asset({ name: '@fixture/message', version: '1.0.0', path: 'notice.txt' });
	assert.deepEqual([duplicated.failure.code, codes(duplicated.failure.diagnostics)], ['BUILD_FAILED', ['PACKAGE_DUPLICATED']]);
});
