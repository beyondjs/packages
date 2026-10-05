/**
 * Criterion 10 of the local installation: what a local installation reuses of the resolution and the source fetch
 * is the behavior CDN preparation runs, and what belongs to a local workspace never enters CDN's path.
 *
 * - Pinning the external roots of an application with `Resolution.pin` gives exactly the releases (key, origin,
 *   visibility, integrity, archive) and edges the workspace lock records for them. A peer's context differs on
 *   purpose: the lock names the application that provides the peer, a pinned graph the root selection.
 * - `Resolution.pin` refuses a `workspace:` specification, as a root and as a dependency a registry package
 *   declares, and asks no registry anything for it.
 * - A private release keeps its isolation: a local installation stores it for its own tenant (`local`) and writes
 *   no credential, and a CDN tenant fetching the same release into the same store gets a copy of its own.
 * - `Sources.fetch` refuses a graph that holds a workspace node and stores nothing for it.
 *
 * The workspace, the registry releases and the harness are those of the local installation's acceptance
 * (`tests/local-install/fixtures/acceptance`, `tests/local-install/support`). Run from the Packages directory under
 * BEE Node, with the bootstrap Engine serving this checkout and the utilities (`BEE_URL`) and a BEE Node checkout
 * (`BEE_NODE_DIR`), as `tests/stage-1/README.md` describes; no watchers service is needed:
 *
 *     BEE_URL=http://localhost:1112,… node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-resolution/workspace.test.mjs
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Resolution } from '@beyond-js/packages/resolution';
import { Sources, FilesystemStore } from '@beyond-js/packages/sources';
import { PackageProviders } from '@beyond-js/packages/providers';
import { Scenario } from '../local-install/support/scenario.mjs';
import { Catalog } from '../local-install/support/catalog.mjs';
import { Graph } from '../local-install/support/graph.mjs';
import { Store } from '../local-install/support/store.mjs';

const BOUND = { timeout: 180_000 };
const explain = value => JSON.stringify(value, null, 1);
const scenario = new Scenario('cdn-parity');
let lock;

before(async () => {
	await scenario.open({ sets: ['initial', 'refusal'], groups: ['workspace', 'repositories'] });
	const report = await scenario.workspace.install();
	assert.equal(report.valid, true, explain(report.diagnostics));
	lock = scenario.workspace.lock();
});
after(() => scenario.close());

// As CDN pins: provider settings given as values, isolated from the rc files and environment of the host
const pin = roots => Resolution.pin({ roots, providers: { values: { default: { registry: scenario.registry.url } } } });
const release = node => ['name', 'version', 'origin', 'visibility', 'integrity', 'tarball'].map(key => [key, node[key]]);
const shape = ({ from, to, kind, range, name }) => JSON.stringify({ from, to, kind, range, name });

const applications = [
	['apps/app', { react: '^19.0.0', 'react-dom': '^19.0.0', 'use-store': '^1.0.0' }],
	['apps/app18', { react: '^18.2.0', 'react-dom': '^18.2.0', 'use-store': '^1.0.0' }]
];
for (const [application, roots] of applications) {
	test(`pinning the external roots of ${application} gives the releases and edges its workspace lock records`, BOUND, async () => {
		const pinned = await pin(roots);
		assert.ok(Resolution.valid(pinned), explain(pinned.diagnostics));
		const { document, graph } = lock;
		for (const [key, node] of Object.entries(pinned.nodes)) {
			assert.ok(document.nodes[key], `${key} is in the lock`);
			assert.deepEqual(release(document.nodes[key]), release(node), key);
		}
		// Each root is the node the application's own edge reaches
		const member = Graph.member(application);
		for (const { name, node } of pinned.roots) assert.equal(graph.edge(member, name).to, node, name);
		// The same edges between releases; a peer's context is the application in the lock, and it provides there
		// the release the pinned graph selected
		const recorded = new Set(document.edges.filter(({ from }) => from in pinned.nodes).map(shape));
		for (const edge of pinned.edges) assert.ok(recorded.has(shape(edge)), `${shape(edge)} is in the lock`);
		for (const edge of pinned.edges.filter(({ context }) => context)) {
			assert.equal(graph.edge(edge.from, graph.declared(edge), member).to, edge.to, `${shape(edge)} in ${member}`);
		}
	});
}

test('Resolution.pin refuses a workspace: specification, as a root and as a declared dependency, asking nothing for it', BOUND, async () => {
	scenario.reset();
	const refused = [await pin({ '@lt/message': 'workspace:^1.0.0' }), await pin({ 'declares-workspace': '1.0.0' })];
	for (const document of refused) {
		assert.equal(Resolution.valid(document), false);
		const errors = document.diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code);
		assert.ok(errors.some(code => ['INVALID_SPECIFIER', 'SOURCE_UNSUPPORTED'].includes(code)), explain(document.diagnostics));
		assert.deepEqual(Object.values(document.nodes).filter(({ name }) => name === '@lt/message'), []);
	}
	// The registry publishes higher versions of @lt/message: a refusal never falls back to them
	assert.deepEqual(scenario.registry.log.filter(({ path }) => path.includes('/@lt/')), []);
});

test('a private release a local installation fetched stays the local tenant\'s: no credential is written, and a CDN tenant fetches its own copy', BOUND, async t => {
	const TOKEN = 'npm_LOCALinstallTOKEN0123456789';
	const secured = await Catalog.registry(['private'], { prefix: '/private', token: TOKEN });
	t.after(() => secured.stop());
	scenario.layout.copy('private');
	const values = { default: { registry: scenario.registry.url }, scopes: { '@acme': { registry: secured.url, auth: { mode: 'token', token: TOKEN } } } };
	const project = scenario.project('private', { values });
	const report = await project.install();
	assert.equal(report.valid, true, explain(report.diagnostics));

	const { document, text, graph } = project.lock();
	const key = graph.key('@acme/secret', '1.0.0');
	assert.deepEqual([document.nodes[key].visibility, document.nodes[key].access], ['private', 'credential']);
	for (const written of [text, project.files().projection]) assert.ok(!written.includes(TOKEN), 'no credential is written');
	const store = new Store(scenario.store);
	assert.deepEqual(store.sources('@acme/secret').map(({ scope }) => scope), ['org:local']);

	// CDN fetches the same release for its own tenant, into the same store: the local copy is never offered to it
	const subset = { protocol: 'beyond-graph/1', roots: [], nodes: { [key]: document.nodes[key] }, edges: [], overrides: [], exceptions: [], diagnostics: [], digest: document.digest };
	const providers = new PackageProviders({ values, user: false, global: false, env: false });
	const fetched = await Sources.fetch(subset, new FilesystemStore(scenario.store), undefined, 'acme', providers);
	assert.equal(fetched.complete, true, explain(fetched.diagnostics));
	assert.deepEqual(fetched.packages.map(({ scope, reused }) => [scope, reused]), [['org:acme', false]]);
	assert.deepEqual(store.sources('@acme/secret').map(({ scope }) => scope).sort(), ['org:acme', 'org:local']);
});

test('Sources.fetch refuses a graph that holds a workspace node, and stores nothing for it', BOUND, async () => {
	const { document } = lock;
	const { nodes, edges, exceptions, overrides, digest } = document;
	const graph = { protocol: 'beyond-graph/1', roots: [], nodes, edges, overrides, exceptions, diagnostics: [], digest };
	const directory = scenario.layout.path('store-cdn');
	const report = await Sources.fetch(graph, new FilesystemStore(directory), undefined, 'acme');
	assert.equal(report.complete, false);
	const local = Object.keys(nodes).filter(key => nodes[key].origin.provider === 'workspace');
	const whole = report.diagnostics.some(({ code, node }) => code === 'GRAPH_INVALID' && !node);
	const named = local.every(key => report.diagnostics.some(({ node }) => node === key));
	assert.ok(whole || named, `every workspace node is refused: ${explain(report.diagnostics)}`);
	assert.deepEqual(report.packages.filter(({ node }) => local.includes(node)), []);
	assert.deepEqual(new Store(directory).sources().filter(({ name }) => name.startsWith('@lt/')), []);
});
