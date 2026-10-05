/**
 * The graph of a workspace (`Resolution.workspace`, `beyond-workspace-graph/1`) as its members own their names:
 * the highest satisfying member, several local versions of one name, `workspace:` specifiers and their refusal
 * outside an importer (pinned, or declared by an installed package), the registry never asked for an owned name
 * while the external closure is resolved, escapes to the registry and what they conflict with, members that require
 * each other, and the digest. Peers, importers, overrides, development dependencies and the lock are validated by
 * `resolution.peers.test.mjs`. The members are the checked-in manifests of `fixtures/resolution` (see its README);
 * the harness is `support/resolution.mjs`.
 *
 * Run from the Packages directory under BEE Node, with the bootstrap Engine serving this implementation at
 * `BEE_URL` and the loader of `BEE_NODE_DIR` (see `tests/stage-1/README.md`); no watcher is needed:
 *
 * ```sh
 * BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/resolution.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { Resolution } from '@beyond-js/packages/resolution';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { Workspaces, codes, explain, node, edges, canonical } from './support/resolution.mjs';

const workspaces = new Workspaces();
const { registry } = workspaces;
const resolve = (ids, params) => workspaces.resolve(ids, params);
const requested = name => workspaces.requested(name);
const member = id => workspaces.member(id);

before(() => workspaces.start());
after(() => workspaces.stop());

test('an owned name is satisfied by its member and never requested, whatever the registry publishes', async () => {
	registry.reset();
	const graph = await resolve(['apps/app', 'packages/widgets']);
	assert.ok(Resolution.valid(graph), explain(graph));
	assert.equal(graph.protocol, 'beyond-workspace-graph/1');

	// The registry publishes @acme/widgets up to 3.0.0: not one request reached it
	assert.deepEqual(requested('@acme/widgets'), []);
	assert.deepEqual(graph.members, {
		'apps/app': { name: 'app', version: '1.0.0', node: 'workspace:apps/app' },
		'packages/widgets': { name: '@acme/widgets', version: '1.1.4', node: 'workspace:packages/widgets' }
	});
	assert.deepEqual(graph.nodes['workspace:packages/widgets'], {
		name: '@acme/widgets',
		version: '1.1.4',
		origin: { provider: 'workspace' },
		member: 'packages/widgets',
		visibility: 'public',
		integrity: null,
		tarball: null
	});
	const [widgets] = edges(graph, 'workspace:apps/app', '@acme/widgets');
	assert.deepEqual(widgets, {
		from: 'workspace:apps/app',
		to: 'workspace:packages/widgets',
		kind: 'dependency',
		range: '^1.0.0'
	});

	// The external closure of the members is resolved: what widgets requires, transitive dependencies included
	assert.equal(edges(graph, 'workspace:packages/widgets', '@acme/core')[0].to, node(graph, '@acme/core', '1.0.5'));
	const dom = node(graph, 'react-dom', '19.1.1');
	assert.equal(edges(graph, dom, 'scheduler')[0].to, node(graph, 'scheduler', '0.26.0'));
	assert.match(graph.digest, /^sha256-[0-9a-f]{64}$/);

	// Metadata only: one package document per external package, no manifest and no archive
	assert.deepEqual(
		registry.log.map(({ type, path }) => `${type} ${path}`).sort(),
		['/npm/@acme/core', '/npm/dev-tool', '/npm/react', '/npm/react-dom', '/npm/scheduler'].map(
			path => `packument ${path}`
		)
	);
});

test('the highest member that satisfies a range is selected, and a member outside the root is one more', async () => {
	registry.reset();
	const graph = await resolve(['apps/app', 'packages/widgets', 'packages/widgets-next', '../outside/widgets-v2']);
	assert.ok(Resolution.valid(graph), explain(graph));

	// ^1.0.0 admits 1.1.4 and 1.2.0, never 2.0.0
	assert.equal(edges(graph, 'workspace:apps/app', '@acme/widgets')[0].to, 'workspace:packages/widgets-next');
	assert.equal(graph.members['../outside/widgets-v2'].node, 'workspace:../outside/widgets-v2');
	assert.equal(graph.nodes['workspace:../outside/widgets-v2'].version, '2.0.0');
	assert.deepEqual(requested('@acme/widgets'), []);
});

test('two local versions of one name are used by the consumers whose ranges select them', async () => {
	registry.reset();
	const ids = ['apps/legacy', 'apps/modern', 'packages/widgets', 'packages/widgets-next', '../outside/widgets-v2'];
	const graph = await resolve(ids);
	assert.ok(Resolution.valid(graph), explain(graph));

	assert.equal(edges(graph, 'workspace:apps/legacy', '@acme/widgets')[0].to, 'workspace:packages/widgets');
	assert.equal(edges(graph, 'workspace:apps/modern', '@acme/widgets')[0].to, 'workspace:../outside/widgets-v2');
	const instances = Object.values(graph.nodes).filter(({ name }) => name === '@acme/widgets');
	assert.deepEqual(instances.map(({ version }) => version).sort(), ['1.1.4', '1.2.0', '2.0.0']);
	assert.deepEqual(requested('@acme/widgets'), []);
});

test('a range no member satisfies is WORKSPACE_RANGE_UNSATISFIED, and the registry is not asked', async () => {
	registry.reset();
	const graph = await resolve(['apps/unsatisfied', 'packages/widgets', '../outside/widgets-v2']);

	assert.equal(Resolution.valid(graph), false);
	assert.deepEqual(codes(graph, 'error'), ['WORKSPACE_RANGE_UNSATISFIED']);
	const [{ message, node: from }] = graph.diagnostics;
	assert.equal(from, 'workspace:apps/unsatisfied');
	assert.match(
		message,
		/^workspace:apps\/unsatisfied requires "@acme\/widgets@\^3\.0\.0"; the workspace provides 2\.0\.0, 1\.1\.4 \(\.\.\/outside\/widgets-v2, packages\/widgets\)/
	);
	assert.deepEqual(edges(graph, 'workspace:apps/unsatisfied', '@acme/widgets'), []);

	// The registry publishes 3.0.0: it is still never a candidate
	assert.deepEqual(requested('@acme/widgets'), []);
});

test('workspace: specifiers select among the members of the name, or name one member', async () => {
	registry.reset();
	const ids = [
		'apps/star',
		'apps/caret',
		'apps/ranged',
		'apps/named',
		'packages/widgets',
		'packages/widgets-next',
		'../outside/widgets-v2'
	];
	const graph = await resolve(ids);
	assert.ok(Resolution.valid(graph), explain(graph));

	const selected = id => edges(graph, `workspace:apps/${id}`, '@acme/widgets').map(({ to, range }) => [to, range]);
	assert.deepEqual(selected('star'), [['workspace:../outside/widgets-v2', 'workspace:*']]);
	assert.deepEqual(selected('caret'), [['workspace:../outside/widgets-v2', 'workspace:^']]);
	assert.deepEqual(selected('ranged'), [['workspace:packages/widgets-next', 'workspace:^1.0.0']]);
	// An id names its member even when a higher version satisfies the name
	assert.deepEqual(selected('named'), [['workspace:packages/widgets', 'workspace:packages/widgets']]);
	assert.deepEqual(requested('@acme/widgets'), []);
});

test('a workspace: specifier is read as a range of the declared name or as the id of one member', () => {
	const read = spec => {
		const source = new DependencySource('@acme/widgets', spec);
		const { is, range, member, error } = source.data;
		return error ? error.code : [source.id, is, range ?? null, member ?? null];
	};
	const id = 'workspace:@acme/widgets';

	for (const spec of ['workspace:*', 'workspace:^', 'workspace:~', 'workspace:']) {
		assert.deepEqual(read(spec), [id, 'workspace', '*', null], spec);
	}
	assert.deepEqual(read('workspace:^1.0.0'), [id, 'workspace', '^1.0.0', null]);
	assert.deepEqual(read('workspace:>=1.0.0 <2.0.0'), [id, 'workspace', '>=1.0.0 <2.0.0', null]);
	assert.deepEqual(read('workspace:packages/widgets'), [id, 'workspace', null, 'packages/widgets']);
	assert.deepEqual(read('workspace:../outside/widgets-v2/'), [id, 'workspace', null, '../outside/widgets-v2']);
	assert.deepEqual(read('workspace:.'), [id, 'workspace', null, '.']);
	// An id that reads as a range is written with `./`
	assert.deepEqual(read('workspace:v1'), [id, 'workspace', 'v1', null]);
	assert.deepEqual(read('workspace:./v1'), [id, 'workspace', null, 'v1']);
	assert.equal(read('workspace:/packages/widgets'), 'INVALID_SPECIFIER');
	assert.equal(read('workspace:packages\\widgets'), 'INVALID_SPECIFIER');
});

test('a workspace: specifier of a name or an id no member has is WORKSPACE_PACKAGE_NOT_FOUND', async () => {
	registry.reset();
	const graph = await resolve(['apps/missing', 'apps/unknown', 'packages/widgets']);

	assert.equal(Resolution.valid(graph), false);
	assert.deepEqual(codes(graph, 'error'), ['WORKSPACE_PACKAGE_NOT_FOUND', 'WORKSPACE_PACKAGE_NOT_FOUND']);
	const messages = graph.diagnostics.map(({ message }) => message).join('\n');
	assert.match(messages, /no member of the workspace provides "@acme\/missing"/);
	assert.match(messages, /the workspace has no member "packages\/nowhere"/);
	assert.deepEqual([...requested('@acme/missing'), ...requested('@acme/widgets')], []);
});

test('an npm: alias reaches the registry copy of an owned name under its own key', async () => {
	registry.reset();
	const graph = await resolve(['apps/escape', 'packages/widgets']);
	assert.ok(Resolution.valid(graph), explain(graph));

	const copy = node(graph, '@acme/widgets', '1.9.9');
	assert.ok(copy && !copy.startsWith('workspace:'), copy);
	assert.deepEqual(edges(graph, 'workspace:apps/escape', 'widgets-registry'), [
		{
			from: 'workspace:apps/escape',
			to: copy,
			kind: 'dependency',
			range: 'npm:@acme/widgets@^1.5.0',
			name: 'widgets-registry'
		}
	]);
	// The plain range of the same name is still the member's
	assert.equal(edges(graph, 'workspace:apps/escape', '@acme/widgets')[0].to, 'workspace:packages/widgets');
	assert.deepEqual(
		requested('@acme/widgets').map(({ type }) => type),
		['packument']
	);
});

test('two nodes with one name and version are INSTANCE_NAME_CONFLICT', async () => {
	const graph = await resolve(['apps/conflict', 'packages/widgets']);

	assert.equal(Resolution.valid(graph), false);
	assert.deepEqual(codes(graph, 'error'), ['INSTANCE_NAME_CONFLICT']);
	const copy = node(graph, '@acme/widgets', '1.1.4');
	const [{ message }] = graph.diagnostics;
	assert.ok(message.includes(copy) && message.includes('workspace:packages/widgets'), message);
	assert.match(message, /^"@acme\/widgets@1\.1\.4" is provided by 2 nodes/);
});

test('members that require each other are one node each, linked both ways', async () => {
	const graph = await resolve(['packages/cycle-a', 'packages/cycle-b']);
	assert.ok(Resolution.valid(graph), explain(graph));

	assert.deepEqual(Object.keys(graph.nodes), ['workspace:packages/cycle-a', 'workspace:packages/cycle-b']);
	assert.deepEqual(
		graph.edges.map(({ from, to }) => [from, to]),
		[
			['workspace:packages/cycle-a', 'workspace:packages/cycle-b'],
			['workspace:packages/cycle-b', 'workspace:packages/cycle-a']
		]
	);
});

test('the digest does not depend on the order of members or of declarations', async () => {
	const ids = ['apps/legacy', 'apps/modern', 'packages/widgets', 'packages/widgets-next', '../outside/widgets-v2'];
	const forward = await resolve(ids);

	const reverse = object =>
		object && typeof object === 'object' ? Object.fromEntries(Object.entries(object).reverse()) : object;
	const members = (await Promise.all([...ids].reverse().map(member))).map(member => {
		const manifest = reverse(member.manifest);
		for (const group of ['dependencies', 'peerDependencies']) manifest[group] = reverse(manifest[group]);
		return { ...member, manifest };
	});
	const backward = await resolve(null, { members });

	assert.ok(Resolution.valid(forward), explain(forward));
	assert.equal(backward.digest, forward.digest);
	const { digest, ...content } = forward;
	assert.equal(digest, `sha256-${createHash('sha256').update(canonical(content)).digest('hex')}`);
});

test('a workspace: specifier only an importer may declare: pin and an installed package are refused', async () => {
	registry.reset();
	const providers = { values: { default: { registry: registry.url } } };
	const pinned = await Resolution.pin({ roots: { '@acme/widgets': 'workspace:^1.0.0' }, providers });
	assert.deepEqual(codes(pinned, 'error'), ['SOURCE_UNSUPPORTED']);
	assert.equal(pinned.roots[0].node, undefined);
	assert.deepEqual(registry.log, []);

	// leaky@1.0.0 declares two dependencies and a peer with `workspace:`: a workspace refuses them as pin does, and
	// binds none of them to its members
	const graph = await resolve(['apps/leak', 'packages/widgets']);
	const refused = ['SOURCE_UNSUPPORTED', 'SOURCE_UNSUPPORTED', 'SOURCE_UNSUPPORTED'];
	assert.deepEqual(codes(graph, 'error'), refused);
	const leaky = node(graph, 'leaky', '1.0.0');
	for (const { node: from, message } of graph.diagnostics) {
		assert.equal(from, leaky);
		assert.match(message, /is a workspace: specifier declared by an installed package/);
	}
	assert.ok(!graph.edges.some(({ from }) => from === leaky));
	assert.deepEqual([...requested('@acme/widgets'), ...requested('anything')], []);
	assert.deepEqual(codes(await Resolution.pin({ roots: { leaky: '1.0.0' }, providers }), 'error'), refused);
});

test('members that cannot be resolved: a programming error rejects, an invalid manifest is a diagnostic', async () => {
	await assert.rejects(Resolution.workspace({ members: 'apps/app' }), /members of the workspace are required/);
	const app = await member('apps/app');
	await assert.rejects(Resolution.workspace({ members: [app, app] }), /given more than once/);
	await assert.rejects(
		Resolution.workspace({ members: [{ ...app, id: 'apps/../apps/app' }] }),
		/canonical relative path/
	);
	await assert.rejects(Resolution.workspace({ members: [{ ...app, id: '/apps/app' }] }), /canonical relative path/);

	// A member without a valid version is no instance, and still owns its name: the registry is not asked for it
	registry.reset();
	const graph = await resolve(null, { members: [app, { ...(await member('packages/widgets')), version: 'next' }] });
	assert.equal(Resolution.valid(graph), false);
	assert.deepEqual(codes(graph, 'error'), ['MEMBER_MANIFEST_INVALID', 'WORKSPACE_PACKAGE_NOT_FOUND']);
	assert.deepEqual(graph.members, { 'apps/app': { name: 'app', version: '1.0.0', node: 'workspace:apps/app' } });
	assert.deepEqual(requested('@acme/widgets'), []);

	// A declaration that cannot be read is a warning naming its member, not a silent omission
	const broken = { ...app, manifest: { ...app.manifest, dependencies: { ...app.manifest.dependencies, broken: 1 } } };
	const warned = await resolve(null, { members: [broken, await member('packages/widgets')] });
	assert.ok(Resolution.valid(warned), explain(warned));
	const expected = 'The member "apps/app": Invalid value for "broken" in "dependencies": expected string, got number';
	assert.deepEqual(
		warned.diagnostics.map(({ code, message }) => [code, message]),
		[['RESOLUTION_WARNING', expected]]
	);
});
