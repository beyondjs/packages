/**
 * The execution projection of an installed workspace (`@beyond-js/packages/execution`): how a consumer reads
 * `.beyond/execution.json`, which state it finds it in, and how an import follows the importer's edges instead
 * of a name. The projection of `fixtures/installation/projection` is hand-written; the harness of
 * `support/installation.mjs` copies the fixture to a unique temporary directory and substitutes the locations of
 * this run (see the fixtures README).
 *
 * ```sh
 * # BEE_URL and BEE_NODE_DIR: the bootstrap Engine serving this checkout and the loader (tests/stage-1/README.md)
 * node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/execution.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Execution } from '@beyond-js/packages/execution';
import { projection, temporary } from './support/installation.mjs';

const W2 = 'workspace:../outside/widgets-v2';

const codes = diagnostics => diagnostics.map(({ code }) => code);

test('a projection written from the current lock and inputs is ready', async t => {
	const { root, store, document, inputs } = await projection(t);
	const { execution, state, diagnostics } = await Execution.read(root, { inputs });

	assert.deepEqual([state, diagnostics, execution.state, execution.diagnostics], ['ready', [], 'ready', []]);
	assert.equal(execution.root, root);
	assert.equal(execution.lock, document.lock);
	assert.equal(execution.store, store);
	assert.equal(execution.written, '2026-10-05T12:00:00.000Z');
	assert.deepEqual(execution.inputs, inputs);
	assert.deepEqual([Execution.PATH, Execution.LOCK], ['.beyond/execution.json', 'beyond-lock.json']);

	// Without current inputs, only the lock is compared
	assert.equal((await Execution.read(root)).state, 'ready');
});

test('members and nodes are found by id, key, name, version and location', async t => {
	const { root, outside, store, document } = await projection(t);
	const { execution } = await Execution.read(root);
	const react = document.nodes['npm:react@19.1.1'].location;

	assert.deepEqual([...execution.members.keys()], ['../outside/widgets-v2', 'app', 'legacy', 'widgets-v1']);
	const member = { id: '../outside/widgets-v2', name: '@fixture/widgets', version: '2.0.0', node: W2 };
	assert.deepEqual(execution.members.get(member.id), { ...member, location: join(outside, 'widgets-v2') });

	// Every node, members' nodes included, with its location
	const nodes = execution.nodes;
	assert.equal(nodes.size, 9);
	assert.equal(nodes.get('workspace:app').location, join(root, 'app'));
	assert.ok(nodes.get('npm:react@19.1.1').location === react && react.startsWith(`${store}/public/npm/react/`));
	assert.equal(nodes.get(W2).member, '../outside/widgets-v2');
	assert.deepEqual(execution.node('npm:react@18.3.1'), { ...nodes.get('npm:react@18.3.1') });
	assert.equal(execution.node('npm:react@18.3.1').key, 'npm:react@18.3.1');
	assert.equal(execution.node('npm:react@17.0.2'), undefined);

	assert.deepEqual(execution.find('@fixture/widgets'), [W2, 'workspace:widgets-v1']);
	assert.deepEqual(execution.find('@fixture/widgets', '1.0.0'), ['workspace:widgets-v1']);
	assert.deepEqual(execution.find('react'), ['npm:react@18.3.1', 'npm:react@19.1.1']);
	assert.deepEqual(execution.find('react', '17.0.2'), []);
	assert.deepEqual(execution.find('vue'), []);

	assert.equal(execution.instance(join(outside, 'widgets-v2')), W2);
	assert.equal(execution.instance(`${react}/`), 'npm:react@19.1.1');
	assert.equal(execution.instance(join(root, 'app', 'src')), undefined, 'a location is equal, never containing');
	assert.equal(execution.instance(root), undefined);

	// What a consumer reads cannot change what another one finds
	assert.throws(() => (execution.node('workspace:app').location = '/elsewhere'), TypeError);
	execution.nodes.delete('workspace:app');
	assert.ok(execution.node('workspace:app'));
});

test('an import follows the edges of its importer', async t => {
	const { root, outside, document } = await projection(t);
	const { execution } = await Execution.read(root);

	const app = execution.resolve('workspace:app', '@fixture/widgets');
	assert.deepEqual([app.key, app.node.location], [W2, join(outside, 'widgets-v2')]);
	assert.equal(execution.resolve('workspace:legacy', '@fixture/widgets').key, 'workspace:widgets-v1');
	assert.equal(execution.resolve('workspace:app', 'react').key, 'npm:react@19.1.1');
	assert.equal(execution.resolve('workspace:legacy', 'react').key, 'npm:react@18.3.1');
	assert.equal(execution.resolve('workspace:widgets-v1', 'react').key, 'npm:react@18.3.1');
	assert.equal(execution.resolve(W2, 'react').key, 'npm:react@19.1.1');
	assert.equal(execution.resolve('npm:react-dom@19.1.1', 'scheduler').key, 'npm:scheduler@0.26.0');

	// An alias is imported by its declared name and reaches its target
	const alias = execution.resolve('workspace:app', 'react-legacy');
	assert.deepEqual([alias.key, alias.node.name], ['npm:react@18.3.1', 'react']);

	// A package imports itself by its own name
	assert.equal(execution.resolve('workspace:widgets-v1', '@fixture/widgets').key, 'workspace:widgets-v1');
	assert.equal(execution.resolve('npm:react@19.1.1', 'react').key, 'npm:react@19.1.1');

	// The edges of a node, in the order the projection records them
	const legacy = execution.edges('workspace:legacy');
	assert.deepEqual(
		legacy,
		document.edges.filter(({ from }) => from === 'workspace:legacy')
	);
	assert.equal(legacy.length, 3);
	assert.deepEqual(execution.edges('npm:scheduler@0.26.0'), []);
});

test('a peer follows the context that reached its importer', async t => {
	const { root } = await projection(t);
	const { execution } = await Execution.read(root);

	assert.equal(execution.resolve('npm:some-ui@1.0.0', 'react', 'workspace:app').key, 'npm:react@19.1.1');
	assert.equal(execution.resolve('npm:some-ui@1.0.0', 'react', 'workspace:legacy').key, 'npm:react@18.3.1');
	// One context only: every edge agrees on the node
	assert.equal(execution.resolve('npm:react-dom@19.1.1', 'react').key, 'npm:react@19.1.1');

	const missing = execution.resolve('npm:some-ui@1.0.0', 'react');
	assert.equal(missing.key, undefined);
	assert.equal(missing.error.code, 'PEER_CONTEXT_AMBIGUOUS');
	assert.equal(missing.error.node, 'npm:some-ui@1.0.0');
	assert.deepEqual(missing.error.details.candidates, [
		{ to: 'npm:react@19.1.1', context: 'workspace:app' },
		{ to: 'npm:react@18.3.1', context: 'workspace:legacy' }
	]);

	// A context no edge names never selects the target of another context's edge...
	const other = execution.resolve('npm:some-ui@1.0.0', 'react', 'workspace:widgets-v1');
	assert.equal(other.key, undefined);
	assert.equal(other.error.code, 'PEER_CONTEXT_AMBIGUOUS');
	assert.match(other.error.message, /the context workspace:widgets-v1 binds none of them/);
	// ...unless every edge points to that node
	assert.equal(execution.resolve('npm:react-dom@19.1.1', 'react', 'workspace:legacy').key, 'npm:react@19.1.1');
});

test('the edge of the given context wins, then the edge without a context', async t => {
	const { root, document } = await projection(t);
	// A variant in memory: some-ui also binds react without a context
	const own = { from: 'npm:some-ui@1.0.0', to: 'npm:react@18.3.1', kind: 'dependency', range: '^18.3.0' };
	const execution = Execution.from({ ...document, edges: [...document.edges, own] }, root);

	assert.equal(execution.resolve('npm:some-ui@1.0.0', 'react', 'workspace:app').key, 'npm:react@19.1.1');
	assert.equal(execution.resolve('npm:some-ui@1.0.0', 'react').key, 'npm:react@18.3.1');
	assert.equal(execution.resolve('npm:some-ui@1.0.0', 'react', 'workspace:widgets-v1').key, 'npm:react@18.3.1');
});

test('an import the graph does not provide is refused, never guessed by name', async t => {
	const { root } = await projection(t);
	const { execution } = await Execution.read(root);

	// scheduler is in the graph, but not an edge of the application
	const undeclared = execution.resolve('workspace:app', 'scheduler');
	assert.equal(undeclared.key, undefined);
	assert.deepEqual(undeclared.error, {
		code: 'DEPENDENCY_NOT_INSTALLED',
		message: 'workspace:app imports scheduler, which its graph does not provide: declare it and run beyond install',
		severity: 'error',
		node: 'workspace:app',
		details: { name: 'scheduler' }
	});

	const skipped = execution.resolve('workspace:app', 'fsevents');
	assert.equal(skipped.error.code, 'DEPENDENCY_NOT_INSTALLED');
	assert.match(skipped.error.message, /optional dependency was skipped: PACKAGE_NOT_FOUND/);

	assert.equal(execution.resolve('npm:react@17.0.2', 'react').error.code, 'DEPENDENCY_NOT_INSTALLED');
});

test('changed inputs make the projection stale, and it is still returned', async t => {
	const { root, inputs } = await projection(t);

	const member = { ...inputs, members: { ...inputs.members, app: `sha256-${'0'.repeat(64)}` } };
	const edited = await Execution.read(root, { inputs: member });
	assert.equal(edited.state, 'stale');
	assert.deepEqual(codes(edited.diagnostics), ['EXECUTION_GRAPH_STALE']);
	assert.deepEqual(edited.diagnostics[0].details, { changed: ['member:app'] });
	assert.equal(edited.diagnostics[0].severity, 'warning');
	assert.equal(edited.execution.state, 'stale');
	assert.equal(edited.execution.resolve('workspace:app', 'react').key, 'npm:react@19.1.1');

	const extra = `sha256-${'2'.repeat(64)}`;
	const added = { declaration: `sha256-${'1'.repeat(64)}`, members: { ...inputs.members, extra } };
	const { state, diagnostics } = await Execution.read(root, { inputs: added });
	assert.deepEqual([state, diagnostics[0].details.changed], ['stale', ['declaration', 'member:extra']]);
	assert.match(diagnostics[0].message, /the workspace declaration, the manifest of the member extra: run beyond/);
});

test('a projection that locates a node where it may not be is incompatible, and is not served', async t => {
	const { base, root, outside, document, inputs } = await projection(t);
	const declared = { app: join(root, 'app'), legacy: join(root, 'legacy'), 'widgets-v1': `${root}/widgets-v1/` };
	// The same directories, and an id the projection does not have (the inputs tell an added member)
	assert.equal((await Execution.read(root, { inputs, locations: { ...declared, extra: base } })).state, 'ready');

	// Another checkout of the legacy member, with the very same manifest
	const checkout = join(base, 'checkout', 'legacy');
	await cp(join(root, 'legacy'), checkout, { recursive: true });
	const moved = await Execution.read(root, { inputs, locations: { ...declared, legacy: checkout } });
	assert.equal(moved.state, 'incompatible');
	assert.deepEqual([moved.execution, moved.diagnostics[0].details], [undefined, { changed: ['member:legacy'] }]);

	// By hand: an external node outside its store or at another package's directory, a member apart from its node
	const refused = async (key, location) => {
		const nodes = { ...document.nodes, [key]: { ...document.nodes[key], location } };
		await writeFile(join(root, Execution.PATH), JSON.stringify({ ...document, nodes }));
		const { state, diagnostics } = await Execution.read(root);
		assert.deepEqual([state, codes(diagnostics)], ['incompatible', ['EXECUTION_GRAPH_INCOMPATIBLE']], location);
		return diagnostics[0].message;
	};
	assert.match(await refused('npm:react@19.1.1', join(root, 'app')), /locates npm:react@19.1.1 outside its store/);
	await refused('npm:react@19.1.1', document.nodes['npm:react-dom@19.1.1'].location);
	await refused('npm:react@19.1.1', join(outside, '..', 'store', 'react'));
	assert.match(await refused('workspace:legacy', join(root, 'app')), /the member legacy and its node apart/);
});

test('a changed or missing lock makes the projection stale', async t => {
	const { root, inputs } = await projection(t);
	const path = join(root, 'beyond-lock.json');
	const lock = JSON.parse(await readFile(path, 'utf8'));

	// An edit that keeps the recorded digest is still a change: the digest is computed from the content
	lock.edges[0].range = '^19.2.0';
	await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
	const edited = await Execution.read(root, { inputs });
	assert.deepEqual([edited.state, edited.diagnostics[0].details.changed], ['stale', ['lock']]);
	assert.ok(edited.execution);

	await rm(path);
	const missing = await Execution.read(root, { inputs });
	assert.deepEqual([missing.state, missing.diagnostics[0].details.changed], ['stale', ['lock']]);
});

test('sources no longer at their location make the projection incomplete', async t => {
	const { root, document, inputs } = await projection(t);
	await rm(document.nodes['npm:react@18.3.1'].location, { recursive: true });
	await rm(join(root, 'legacy'), { recursive: true });

	const { execution, state, diagnostics } = await Execution.read(root, { inputs });
	assert.equal(state, 'incomplete');
	const found = diagnostics.map(({ code, node, severity }) => [code, node, severity]);
	assert.deepEqual(found, [
		['SOURCE_MISSING', 'npm:react@18.3.1', 'error'],
		['SOURCE_MISSING', 'workspace:legacy', 'error']
	]);
	assert.equal(execution.state, 'incomplete');
	assert.equal(execution.resolve('workspace:app', 'react').key, 'npm:react@19.1.1');
});

test('without a projection the state is missing', async t => {
	const base = await temporary(t, 'beyond-execution-');

	const { execution, state, diagnostics } = await Execution.read(base);
	assert.equal(execution, undefined);
	assert.equal(state, 'missing');
	assert.deepEqual(codes(diagnostics), ['EXECUTION_GRAPH_MISSING']);
	assert.equal((await Execution.read(join(base, 'absent'))).state, 'missing');
});

test('an unusable projection is incompatible and is not returned', async t => {
	const { base, root, document } = await projection(t);
	const path = join(root, Execution.PATH);
	const incompatible = async (content, why) => {
		await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
		const { execution, state, diagnostics } = await Execution.read(root);
		assert.equal(state, 'incompatible', why);
		assert.equal(execution, undefined, why);
		assert.deepEqual(codes(diagnostics), ['EXECUTION_GRAPH_INCOMPATIBLE'], why);
		return diagnostics[0].message;
	};

	assert.match(await incompatible('{"protocol": ', 'invalid JSON'), /is not valid JSON/);
	const protocol = { ...document, protocol: 'beyond-execution/2' };
	assert.match(await incompatible(protocol, 'protocol'), /beyond-execution\/2/);
	assert.match(await incompatible({ ...document, root: join(base, 'moved') }, 'root'), /another root/);
	const vue = { from: 'workspace:app', to: 'npm:vue@3.5.0', kind: 'dependency', range: '^3' };
	const dangling = { ...document, edges: [...document.edges, vue] };
	assert.match(await incompatible(dangling, 'dangling edge'), /unknown node "npm:vue@3.5.0"/);
	const scheduler = { name: 'scheduler', version: '0.26.0' };
	const unlocated = { ...document, nodes: { ...document.nodes, 'npm:scheduler@0.26.0': scheduler } };
	assert.match(await incompatible(unlocated, 'location'), /no absolute location/);
	const edges = document.edges.map(edge => (edge.context ? { ...edge, context: 'npm:none@1.0.0' } : edge));
	assert.match(await incompatible({ ...document, edges }, 'context'), /context that names no node/);
});

test('a document in memory is a ready projection, and an unusable one throws', async t => {
	const { root, document } = await projection(t);

	const execution = Execution.from(document, root);
	assert.equal(execution.state, 'ready');
	assert.equal(execution.resolve('workspace:legacy', '@fixture/widgets').key, 'workspace:widgets-v1');

	const refused = data => assert.throws(() => Execution.from(data, root), { code: 'EXECUTION_GRAPH_INCOMPATIBLE' });
	refused({ ...document, protocol: 'beyond-lock/2' });
	refused({ ...document, root: '/elsewhere' });
	refused({
		...document,
		members: { ...document.members, app: { ...document.members.app, node: 'npm:react@19.1.1' } }
	});
	refused(null);
});
