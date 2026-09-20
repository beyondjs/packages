/**
 * What the pinned graph is for a set of roots: termination, sharing, selection, policies and failures.
 */
import assert from 'node:assert/strict';
import { Resolution } from '@beyond-js/packages/resolution';
import { step, codes, valid, versions, root, edge } from './harness.mjs';

const keys = document => Object.keys(document.nodes);
const explain = document => JSON.stringify(document.diagnostics);

export async function graph({ registry, pin }) {
	await step('cycle: two packages that require each other terminate as one node each', async () => {
		const document = await pin({ roots: { 'cycle-a': '^1.0.0' } });
		assert.ok(valid(document), explain(document));
		assert.deepEqual(versions(document, 'cycle-a'), ['1.0.0']);
		assert.deepEqual(versions(document, 'cycle-b'), ['1.0.0']);
		assert.ok(edge(document, 'cycle-b', 'cycle-a').to.endsWith(':cycle-a@1.0.0'));
		return `${keys(document).length} nodes, ${document.edges.length} edges`;
	});

	await step('diamond: a package required through two paths is one node, requested once', async () => {
		registry.reset();
		const document = await pin({ roots: { 'diamond-top': '1.0.0' } });
		assert.ok(valid(document), explain(document));
		assert.deepEqual(versions(document, 'diamond-base'), ['1.2.5']);
		assert.equal(
			edge(document, 'diamond-left', 'diamond-base').to,
			edge(document, 'diamond-right', 'diamond-base').to
		);
		assert.equal(registry.log.filter(({ path }) => path.endsWith('/diamond-base')).length, 1);
	});

	await step('intersection: ^1.0.0 and ~1.2.0 share the one version that satisfies both', async () => {
		const document = await pin({ roots: { 'diamond-top': '1.0.0' } });
		// ^1.0.0 alone would select 1.3.0; ~1.2.0 alone 1.2.5; the intersection is 1.2.5
		assert.deepEqual(versions(document, 'diamond-base'), ['1.2.5']);
		assert.equal(edge(document, 'diamond-left', 'diamond-base').range, '^1.0.0');
		assert.equal(edge(document, 'diamond-right', 'diamond-base').range, '~1.2.0');
	});

	await step('multi-version: genuinely disjoint ranges yield one node per version', async () => {
		const document = await pin({ roots: { 'multi-old': '1.0.0', 'multi-new': '1.0.0' } });
		assert.ok(valid(document), explain(document));
		assert.deepEqual(versions(document, 'diamond-base'), ['1.3.0', '2.1.0']);
	});

	await step('order: reordered roots and manifests give the same digest', async () => {
		const roots = [
			{ name: 'diamond-top', range: '1.0.0' },
			{ name: 'multi-new', range: '1.0.0' },
			{ name: 'multi-old', range: '1.0.0' },
			{ name: 'cycle-a', range: '^1.0.0' }
		];
		const forward = await pin({ roots, targets: ['browser', 'node'] });
		const backward = await pin({ roots: [...roots].reverse(), targets: ['node', 'browser'] });
		assert.ok(valid(forward), explain(forward));
		assert.equal(forward.digest, backward.digest);
		assert.match(forward.digest, /^sha256-[0-9a-f]{64}$/);

		// With every requirement present, the three ranges of diamond-base resolve to two releases:
		// the order in which they were met does not split the satisfiable ones
		assert.deepEqual(versions(forward, 'diamond-base'), ['1.2.5', '2.1.0']);
		const other = await pin({ roots: roots.slice(0, 3), targets: ['browser', 'node'] });
		assert.notEqual(other.digest, forward.digest);
	});

	await step('peers: a renderer and its peer share the one react its dependent provides', async () => {
		const document = await pin({ roots: { react: '*', 'react-dom': '^18.0.0' } });
		assert.ok(valid(document), explain(document));
		// react@* alone would select 19.0.0: the peer requirement of the renderer constrains the group
		assert.deepEqual(versions(document, 'react'), ['18.3.1']);
		const peer = edge(document, 'react-dom', 'react');
		assert.equal(peer.kind, 'peer');
		assert.equal(peer.to, root(document, 'react'));
		// The root of an application is not a node: the context is the root selection that required it
		assert.equal(peer.context, root(document, 'react-dom'));

		// Below an application package, the context is the dependent that provides the peer
		const nested = await pin({ roots: { 'peer-app': '1.0.0' } });
		assert.ok(valid(nested), explain(nested));
		assert.deepEqual(versions(nested, 'react'), ['18.3.1']);
		assert.equal(edge(nested, 'react-dom', 'react').context, root(nested, 'peer-app'));
		assert.equal(edge(nested, 'react-dom', 'react').to, edge(nested, 'peer-app', 'react').to);
	});

	await step('peers: an unmet required peer is a diagnostic, an optional one is tolerated', async () => {
		const missing = await pin({ roots: { 'react-dom': '^18.0.0' } });
		assert.equal(valid(missing), false);
		assert.deepEqual(codes(missing, 'error'), ['PEER_MISSING']);

		const incompatible = await pin({ roots: { react: '19.0.0', 'react-dom': '^18.0.0' } });
		assert.equal(valid(incompatible), false);
		assert.deepEqual(codes(incompatible, 'error'), ['PEER_INCOMPATIBLE']);

		const optional = await pin({ roots: { 'peer-optional': '1.0.0' } });
		assert.ok(valid(optional), explain(optional));
		assert.equal(edge(optional, 'peer-optional', 'react'), undefined);
	});

	await step('optional: a failing optional dependency is recorded and does not invalidate', async () => {
		const document = await pin({ roots: { 'optional-user': '1.0.0' } });
		assert.ok(valid(document), explain(document));
		assert.deepEqual(codes(document, 'warning'), ['PACKAGE_NOT_FOUND']);
		const skipped = edge(document, 'optional-user', 'not-published');
		assert.deepEqual([skipped.to, skipped.kind, skipped.name], [null, 'optional', 'not-published']);
		assert.match(skipped.skipped, /^PACKAGE_NOT_FOUND: /);

		// The same package required for real is an error
		const required = await pin({ roots: { 'optional-user': '1.0.0', 'not-published': '^1.0.0' } });
		assert.equal(valid(required), false);
		assert.deepEqual(codes(required, 'error'), ['PACKAGE_NOT_FOUND']);
	});

	await step('development: transitive development dependencies are never followed', async () => {
		const document = await pin({ roots: [{ name: 'dev-user', range: '1.0.0' }] });
		assert.ok(valid(document), explain(document));
		assert.deepEqual(versions(document, 'dev-tool'), []);

		const roots = [{ name: 'dev-tool', range: '^1.0.0', kind: 'development' }];
		const ignored = await pin({ roots });
		assert.deepEqual(keys(ignored), []);
		assert.deepEqual(codes(ignored), ['ROOTS_REQUIRED', 'ROOT_NOT_FOLLOWED']);
		assert.deepEqual(versions(await pin({ roots, development: true }), 'dev-tool'), ['1.0.0']);
	});

	await step('overrides: a declared override replaces the required range everywhere', async () => {
		const overrides = { 'diamond-base': '1.0.0' };
		const document = await pin({ roots: { 'diamond-top': '1.0.0' }, overrides });
		assert.ok(valid(document), explain(document));
		assert.deepEqual(versions(document, 'diamond-base'), ['1.0.0']);
		const overridden = edge(document, 'diamond-right', 'diamond-base');
		assert.deepEqual([overridden.range, overridden.override], ['~1.2.0', '1.0.0']);
		assert.deepEqual(document.overrides, [{ name: 'diamond-base', selection: '1.0.0' }]);

		// A nested override only applies below the named package
		const nested = await pin({
			roots: { 'diamond-top': '1.0.0' },
			overrides: { 'diamond-left': { 'diamond-base': '1.0.0' } }
		});
		assert.equal(edge(nested, 'diamond-left', 'diamond-base').override, '1.0.0');
		assert.equal(edge(nested, 'diamond-right', 'diamond-base').override, undefined);
		assert.deepEqual(nested.overrides, [{ name: 'diamond-base', selection: '1.0.0', within: 'diamond-left' }]);
	});

	await step('lock: a pinned lock drives the selection after newer versions are published', async () => {
		const roots = { 'multi-old': '1.0.0', 'cycle-a': '^1.0.0' };
		const before = await pin({ roots });
		await registry.publish({ name: 'diamond-base', version: '1.4.0' });
		await registry.publish({ name: 'cycle-a', version: '1.1.0', dependencies: { 'cycle-b': '^1.0.0' } });

		try {
			const free = await pin({ roots });
			assert.deepEqual(versions(free, 'diamond-base'), ['1.4.0']);
			assert.notEqual(free.digest, before.digest);

			const locked = await pin({ roots, lock: before });
			assert.deepEqual(locked.nodes, before.nodes);
			assert.deepEqual(locked.edges, before.edges);
			assert.deepEqual(locked.lock, { reused: true, digest: before.digest });
			assert.deepEqual(before.lock, { reused: false });

			const reordered = await pin({ roots: { 'cycle-a': '^1.0.0', 'multi-old': '1.0.0' }, lock: before });
			assert.equal(reordered.digest, locked.digest);
		} finally {
			registry.unpublish('diamond-base', '1.4.0');
			registry.unpublish('cycle-a', '1.1.0');
		}
	});

	await step('failures: a missing package and an unresolvable range are explicit and invalidate', async () => {
		const missing = await pin({ roots: { 'not-published': '^1.0.0' } });
		assert.equal(valid(missing), false);
		assert.deepEqual(codes(missing, 'error'), ['PACKAGE_NOT_FOUND']);
		assert.equal(missing.diagnostics[0].node, undefined);
		assert.equal(missing.roots[0].node, undefined);

		const range = await pin({ roots: { 'range-user': '1.0.0' } });
		assert.equal(valid(range), false);
		assert.deepEqual(codes(range, 'error'), ['VERSION_UNRESOLVED']);
		assert.match(
			range.diagnostics[0].message,
			/diamond-base.*\^9\.0\.0.*required through range-user > diamond-base/
		);
		assert.equal(range.diagnostics[0].node, root(range, 'range-user'));
	});

	await step('passes: a graph that cannot settle within the limit fails explicitly', async () => {
		// The diamond needs a second pass to confirm the shared version
		const document = await pin({ roots: { 'diamond-top': '1.0.0' }, passes: 1 });
		assert.equal(valid(document), false);
		assert.deepEqual(codes(document, 'error'), ['GRAPH_UNSETTLED']);
	});
}

/**
 * The packages the checks above resolve
 */
export async function fixtures(registry) {
	const publish = manifest => registry.publish(manifest);

	await publish({ name: 'cycle-a', version: '1.0.0', dependencies: { 'cycle-b': '^1.0.0' } });
	await publish({ name: 'cycle-b', version: '1.0.0', dependencies: { 'cycle-a': '^1.0.0' } });

	for (const version of ['1.0.0', '1.2.0', '1.2.5', '1.3.0', '2.0.0', '2.1.0']) {
		await publish({ name: 'diamond-base', version });
	}
	await publish({ name: 'diamond-left', version: '1.0.0', dependencies: { 'diamond-base': '^1.0.0' } });
	await publish({ name: 'diamond-right', version: '1.0.0', dependencies: { 'diamond-base': '~1.2.0' } });
	await publish({
		name: 'diamond-top',
		version: '1.0.0',
		dependencies: { 'diamond-right': '1.0.0', 'diamond-left': '1.0.0' }
	});

	await publish({ name: 'multi-old', version: '1.0.0', dependencies: { 'diamond-base': '^1.0.0' } });
	await publish({ name: 'multi-new', version: '1.0.0', dependencies: { 'diamond-base': '^2.0.0' } });

	for (const version of ['18.2.0', '18.3.1', '19.0.0']) await publish({ name: 'react', version });
	await publish({ name: 'react-dom', version: '18.3.1', peerDependencies: { react: '^18.3.1' } });
	await publish({ name: 'peer-app', version: '1.0.0', dependencies: { react: '*', 'react-dom': '^18.0.0' } });
	await publish({
		name: 'peer-optional',
		version: '1.0.0',
		peerDependencies: { react: '^18.0.0' },
		peerDependenciesMeta: { react: { optional: true } }
	});

	await publish({
		name: 'optional-user',
		version: '1.0.0',
		dependencies: { 'cycle-a': '^1.0.0' },
		optionalDependencies: { 'not-published': '^1.0.0' }
	});

	await publish({ name: 'dev-tool', version: '1.0.0' });
	await publish({ name: 'dev-user', version: '1.0.0', devDependencies: { 'dev-tool': '^1.0.0' } });
	await publish({ name: 'range-user', version: '1.0.0', dependencies: { 'diamond-base': '^9.0.0' } });
	await publish({ name: 'alias-user', version: '1.0.0', dependencies: { renamed: 'npm:diamond-base@^1.2.0' } });
}
