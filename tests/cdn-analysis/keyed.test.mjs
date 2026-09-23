/**
 * The specifier of an inventory item is the name of its package as the graph pinned it: a registry key
 * (`npm:<name>@<version>`) names the package, a `git:` or `digest:` key names only its source.
 *
 * The same `fake-react` fixture (see the README of this directory) is traced under each form of key.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/cdn-analysis/keyed.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Analysis, Graph, Keyed } from '@beyond-js/packages/analysis';
import { Store, Selected } from './store.mjs';

const KEYS = {
	registry: 'npm:fake-react@18.0.0',
	git: `git:github.com/acme/fake-react@${'a'.repeat(40)}`,
	digest: `digest:sha256-${'b'.repeat(64)}`
};
const conditions = { platform: 'node', environment: 'production' };

for (const [source, key] of Object.entries(KEYS)) {
	test(`the specifier of an item of a ${source} source is named by the graph node`, async t => {
		const store = new Store();
		await store.create();
		t.after(() => store.destroy());
		await store.copy(key, 'fake-react', '18.0.0', 'keyed', 'fake-react');
		const graph = Store.seal({ protocol: 'beyond-graph/1', nodes: { [key]: Store.node('fake-react', '18.0.0') }, edges: [] });
		const sources = { [key]: store.sources[key] };

		const { items, diagnostics } = await Analysis.trace({ graph, sources, entries: ['fake-react', 'fake-react/jsx-runtime'], conditions, compiler: Selected.compiler });
		assert.deepEqual(diagnostics.filter(({ severity }) => severity === 'error'), []);
		const modules = items.filter(({ kind }) => kind === 'module');
		assert.ok(modules.every(item => item.package === key));
		assert.deepEqual(modules.map(item => Keyed.specifier(item, graph)).sort(), ['fake-react', 'fake-react/jsx-runtime']);
		// A caller that holds the `Graph` passes it as it is
		assert.equal(Keyed.specifier({ package: key, subpath: 'jsx-runtime' }, new Graph(graph)), 'fake-react/jsx-runtime');
	});
}

test('the specifier of an item whose package is not in the graph is refused', () => {
	const graph = { protocol: 'beyond-graph/1', nodes: { [KEYS.registry]: Store.node('fake-react', '18.0.0') } };
	assert.throws(() => Keyed.specifier({ package: KEYS.git, subpath: '.' }, graph), /has no node/);
});
