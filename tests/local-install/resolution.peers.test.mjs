/**
 * The importers of a workspace graph (`Resolution.workspace`, `beyond-workspace-graph/1`) and what they are given:
 * the peers an importer resolves as its own and those provided in a context below it, a registry package whose
 * peer is an owned name, root overrides (a `workspace:` one included), the root package as an importer and as a
 * member, development dependencies, and the lock. Ownership and selection of members are validated by `resolution.test.mjs`. The
 * members are the checked-in manifests of `fixtures/resolution` (see its README); the harness is
 * `support/resolution.mjs`.
 *
 * Run from the Packages directory under BEE Node, with the bootstrap Engine serving this implementation at
 * `BEE_URL` and the loader of `BEE_NODE_DIR` (see `tests/stage-1/README.md`); no watcher is needed:
 *
 * ```sh
 * BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/resolution.peers.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Resolution } from '@beyond-js/packages/resolution';
import { Workspaces, codes, explain, node, edges } from './support/resolution.mjs';

const workspaces = new Workspaces();
const { registry } = workspaces;
const resolve = (ids, params) => workspaces.resolve(ids, params);
const requested = name => workspaces.requested(name);
const member = id => workspaces.member(id);
const json = path => workspaces.json(path);

before(() => workspaces.start());
after(() => workspaces.stop());

test('a peer of an importer is its own dependency; below an importer a peer is provided in context', async () => {
	const graph = await resolve(['apps/app', 'packages/widgets']);
	assert.ok(Resolution.valid(graph), explain(graph));
	const react = node(graph, 'react', '19.2.0');

	// widgets resolves its peer as the importer it is, without a context, and in the context of app as its dependency
	const peers = edges(graph, 'workspace:packages/widgets', 'react');
	assert.deepEqual(peers, [
		{
			from: 'workspace:packages/widgets',
			to: react,
			kind: 'peer',
			range: '^19.0.0',
			context: 'workspace:apps/app'
		},
		{ from: 'workspace:packages/widgets', to: react, kind: 'peer', range: '^19.0.0' }
	]);

	// react-dom is below app: app provides its peer
	const dom = node(graph, 'react-dom', '19.1.1');
	assert.deepEqual(edges(graph, dom, 'react'), [
		{ from: dom, to: react, kind: 'peer', range: '^19.1.1', context: 'workspace:apps/app' }
	]);
	assert.equal(edges(graph, 'workspace:apps/app', 'react')[0].to, react);
});

test('a registry package whose peer is an owned name is given the member of its dependent', async () => {
	registry.reset();
	const graph = await resolve(['apps/plugged', 'packages/widgets', '../outside/widgets-v2']);
	assert.ok(Resolution.valid(graph), explain(graph));

	const plugin = node(graph, 'widgets-plugin', '1.0.0');
	assert.deepEqual(edges(graph, plugin, '@acme/widgets'), [
		{
			from: plugin,
			to: 'workspace:packages/widgets',
			kind: 'peer',
			range: '^1.0.0',
			context: 'workspace:apps/plugged'
		}
	]);
	assert.deepEqual(requested('@acme/widgets'), []);

	// A dependent whose member does not satisfy the peer range is told so
	const mismatched = await resolve(['apps/mismatched', 'packages/widgets', '../outside/widgets-v2']);
	assert.equal(Resolution.valid(mismatched), false);
	assert.deepEqual(codes(mismatched, 'error'), ['PEER_INCOMPATIBLE']);
	assert.match(
		mismatched.diagnostics[0].message,
		/"widgets-plugin@1\.0\.0" requires the peer "@acme\/widgets@\^1\.0\.0", but "@acme\/widgets@2\.0\.0"/
	);
});

test('root overrides replace a requirement everywhere, and an alias override escapes the workspace', async () => {
	registry.reset();
	const ids = ['apps/legacy', 'apps/modern', 'packages/widgets', 'packages/widgets-next', '../outside/widgets-v2'];
	const graph = await resolve(ids, { root: { manifest: await json('roots/overrides/package.json') } });
	assert.ok(Resolution.valid(graph), explain(graph));

	// No root importer: the root declares no dependencies of its own
	assert.equal(graph.members['.'], undefined);
	const core = node(graph, '@acme/core', '1.0.0');
	for (const id of ['packages/widgets', 'packages/widgets-next', '../outside/widgets-v2']) {
		const [edge] = edges(graph, `workspace:${id}`, '@acme/core');
		assert.deepEqual([edge.to, edge.override], [core, '1.0.0'], id);
	}

	// A version override of an owned name keeps it owned; an alias override reaches the registry
	const [legacy] = edges(graph, 'workspace:apps/legacy', '@acme/widgets');
	assert.deepEqual(
		[legacy.to, legacy.range, legacy.override],
		['workspace:packages/widgets-next', '~1.1.0', '1.2.0']
	);
	const [modern] = edges(graph, 'workspace:apps/modern', '@acme/widgets');
	assert.deepEqual([modern.to, modern.override], [node(graph, '@acme/widgets', '2.9.9'), 'npm:@acme/widgets@2.9.9']);
	assert.deepEqual(
		requested('@acme/widgets').map(({ type }) => type),
		['packument']
	);
	assert.deepEqual(graph.overrides, [
		{ name: '@acme/core', selection: '1.0.0' },
		{ name: '@acme/widgets', selection: '1.2.0', within: 'legacy' },
		{ name: '@acme/widgets', selection: 'npm:@acme/widgets@2.9.9', within: 'modern' }
	]);
});

test('an override of the root may use workspace: for what an installed package requires', async () => {
	registry.reset();
	const root = { manifest: await json('roots/repair/package.json') };
	const graph = await resolve(['apps/leak', 'packages/widgets', 'packages/widgets-next'], { root });
	assert.ok(Resolution.valid(graph), explain(graph));

	const leaky = node(graph, 'leaky', '1.0.0');
	const declared = name =>
		edges(graph, leaky, name).map(({ to, range, override, context }) => [to, range, override, context]);
	// The id the root names, although a higher member satisfies the name
	assert.deepEqual(declared('@acme/widgets'), [
		['workspace:packages/widgets', 'workspace:*', 'workspace:packages/widgets', undefined]
	]);
	assert.deepEqual(declared('anything'), [
		[node(graph, '@acme/core', '1.0.5'), 'workspace:packages/widgets', 'npm:@acme/core@^1.0.0', undefined]
	]);
	assert.deepEqual(declared('react'), [
		[node(graph, 'react', '19.2.0'), 'workspace:^19.0.0', '^19.0.0', 'workspace:apps/leak']
	]);
	assert.deepEqual(requested('@acme/widgets'), []);
});

test('the root package is an importer of the dependencies it declares', async () => {
	const root = { manifest: await json('roots/importer/package.json') };
	const graph = await resolve(['apps/app', 'packages/widgets'], { root });
	assert.ok(Resolution.valid(graph), explain(graph));

	assert.deepEqual(graph.members['.'], { name: 'fixture-workspace', version: '0.0.0', node: 'workspace:.' });
	assert.equal(graph.nodes['workspace:.'].member, '.');
	assert.deepEqual(
		graph.edges
			.filter(({ from }) => from === 'workspace:.')
			.map(({ kind, range, to }) => [kind, range, graph.nodes[to].name]),
		[
			['build', '^1.0.0', 'dev-tool'],
			['dependency', '^1.0.0', '@acme/core']
		]
	);

	// The name given for the root names its importer
	const named = await resolve(['apps/app', 'packages/widgets'], { root: { ...root, name: 'workspace-root' } });
	assert.equal(named.members['.'].name, 'workspace-root');
});

test('a member that is the root is the only importer of the root, and the root supplies only its overrides', async () => {
	registry.reset();
	const solo = { ...(await member('../standalone')), id: '.' };
	const widgets = await member('packages/widgets');

	// Standalone: the package is member `.`, and its own overrides apply
	const alone = await resolve(null, { members: [solo] });
	assert.ok(Resolution.valid(alone), explain(alone));
	assert.deepEqual(Object.keys(alone.members), ['.']);
	assert.deepEqual(alone.members['.'], { name: 'solo', version: '1.0.0', node: 'workspace:.' });
	assert.equal(edges(alone, 'workspace:.', '@acme/core')[0].to, node(alone, '@acme/core', '1.0.0'));
	// Without a member of that name, @acme/widgets is a registry package
	assert.equal(edges(alone, 'workspace:.', '@acme/widgets')[0].to, node(alone, '@acme/widgets', '1.9.9'));

	// With a root manifest that declares other dependencies: they are not resolved, its overrides are
	registry.reset();
	const importer = await json('roots/importer/package.json');
	const manifest = { ...importer, overrides: { '@acme/core': '1.0.0' } };
	const graph = await resolve(null, { members: [solo, widgets], root: { manifest } });
	assert.ok(Resolution.valid(graph), explain(graph));
	assert.deepEqual(Object.keys(graph.members).sort(), ['.', 'packages/widgets']);
	assert.equal(graph.members['.'].name, 'solo');
	assert.equal(edges(graph, 'workspace:.', '@acme/widgets')[0].to, 'workspace:packages/widgets');
	assert.equal(edges(graph, 'workspace:packages/widgets', '@acme/core')[0].to, node(graph, '@acme/core', '1.0.0'));
	assert.deepEqual(requested('dev-tool'), []);
	assert.deepEqual(requested('@acme/widgets'), []);
});

test('development dependencies are followed for importers, as build edges, and never below them', async () => {
	registry.reset();
	const graph = await resolve(['apps/app', 'packages/widgets']);
	assert.ok(Resolution.valid(graph), explain(graph));

	const [tool] = edges(graph, 'workspace:apps/app', 'dev-tool');
	assert.deepEqual([tool.kind, tool.range, tool.to], ['build', '^1.0.0', node(graph, 'dev-tool', '1.0.0')]);
	// dev-tool declares its own development dependency: below an importer it is never followed
	assert.deepEqual(edges(graph, tool.to, 'dev-helper'), []);
	assert.deepEqual(requested('dev-helper'), []);

	registry.reset();
	const production = await resolve(['apps/app', 'packages/widgets'], { development: false });
	assert.ok(Resolution.valid(production), explain(production));
	assert.equal(node(production, 'dev-tool', '1.0.0'), undefined);
	assert.ok(!production.edges.some(({ kind }) => kind === 'build'));
	assert.deepEqual(requested('dev-tool'), []);
});

test('an importer that develops against a peer uses its development range, and an optional peer is not followed', async () => {
	registry.reset();
	const graph = await resolve(['packages/library']);
	assert.ok(Resolution.valid(graph), explain(graph));

	const from = 'workspace:packages/library';
	assert.deepEqual(
		edges(graph, from, 'react').map(({ kind, range }) => [kind, range]),
		[['build', '^19.1.1']]
	);
	assert.deepEqual(
		edges(graph, from, 'test-runner').map(({ kind }) => kind),
		['build']
	);
	assert.deepEqual(requested('optional-peer'), []);

	// Without its development dependencies, the importer resolves the peer itself
	const production = await resolve(['packages/library'], { development: false });
	assert.ok(Resolution.valid(production), explain(production));
	const [peer] = edges(production, from, 'react');
	assert.deepEqual(
		[peer.kind, peer.range, peer.context, peer.to],
		['peer', '^18.0.0 || ^19.0.0', undefined, node(graph, 'react', '19.2.0')]
	);
	assert.deepEqual(edges(production, from, 'test-runner'), []);
});

test('a member reached from applications that provide different peers records each context', async () => {
	const graph = await resolve(['apps/app18', 'apps/app19', 'packages/ui-lib']);
	assert.ok(Resolution.valid(graph), explain(graph));

	const [react18, react19] = [node(graph, 'react', '18.3.1'), node(graph, 'react', '19.2.0')];
	const peers = edges(graph, 'workspace:packages/ui-lib', 'react').map(({ to, context }) => [to, context]);
	assert.deepEqual(peers, [
		[react18, 'workspace:apps/app18'],
		[react19, 'workspace:apps/app19'],
		[react19, undefined]
	]);
	assert.deepEqual(codes(graph), ['PEER_CONTEXT_CONFLICT']);
	assert.deepEqual(graph.diagnostics[0].severity, 'warning');
	assert.equal(graph.diagnostics[0].node, 'workspace:packages/ui-lib');

	// Each renderer is bound to the react of its own application
	const dom18 = node(graph, 'react-dom', '18.3.1');
	assert.equal(edges(graph, dom18, 'react')[0].context, 'workspace:apps/app18');
	assert.equal(edges(graph, dom18, 'react')[0].to, react18);
});

test('a lock keeps the registry releases it pins, and update ignores it', async t => {
	const ids = ['apps/app', 'packages/widgets'];
	const first = await resolve(ids);
	assert.ok(Resolution.valid(first), explain(first));

	await registry.publish({ name: '@acme/core', version: '1.0.9' });
	t.after(() => registry.unpublish('@acme/core', '1.0.9'));

	const free = await resolve(ids);
	assert.equal(edges(free, 'workspace:packages/widgets', '@acme/core')[0].to, node(free, '@acme/core', '1.0.9'));
	assert.notEqual(free.digest, first.digest);

	// The previous graph as the lock: same inputs, same graph, whatever was published since
	const locked = await resolve(ids, { lock: first });
	assert.equal(locked.digest, first.digest);
	assert.deepEqual(locked.nodes, first.nodes);
	assert.deepEqual(locked.edges, first.edges);

	// A lock file of the installation holds the same nodes: its members pin nothing
	const file = {
		protocol: 'beyond-lock/2',
		members: first.members,
		nodes: first.nodes,
		edges: first.edges,
		digest: first.digest
	};
	assert.equal((await resolve(ids, { lock: file })).digest, first.digest);

	const updated = await resolve(ids, { lock: first, update: true });
	assert.equal(updated.digest, free.digest);
});
