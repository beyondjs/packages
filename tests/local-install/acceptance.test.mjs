/**
 * Acceptance of the owner's criteria 1–4, and the reuse of criterion 5, for installing a local workspace, at the
 * level of Packages' public contracts: the workspace declaration, `@beyond-js/packages/installation`,
 * `@beyond-js/packages/execution` and the Packages workspace that consumes the projection. Freshness, offline limits
 * and failures (criteria 5 and 9) are in `recovery.test.mjs`. Written from the contract and the specification,
 * independently of the implementers' tests; the fixture and what each group establishes are described in this
 * directory's README.
 *
 * Run from the Packages directory under BEE Node, with the bootstrap Engine serving this checkout and the utilities
 * (`BEE_URL`) and a BEE Node checkout (`BEE_NODE_DIR`), as `tests/stage-1/README.md` describes; no watchers service
 * is needed:
 *
 *     BEE_URL=http://localhost:1112,… node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/acceptance.test.mjs
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { Declaration } from '../../service/workspace/declaration.mjs';
import { Context } from '../../service/context.mjs';
import { Layout, Snapshot } from './support/layout.mjs';
import { Scenario } from './support/scenario.mjs';
import { Graph } from './support/graph.mjs';
import { Fixture } from './support/fixture.mjs';
import { Canonical } from './support/canonical.mjs';

const BOUND = { timeout: 180_000 };
const { MEMBERS, RELEASES, MANIFEST } = Fixture;
const { app: APP, app18: APP18, banner: BANNER, view: VIEW, message: MESSAGE, outside: MESSAGE2, root: ROOT } = Fixture.KEYS;
const codes = diagnostics => diagnostics.map(({ code }) => code);
const explain = value => JSON.stringify(value, null, 1);
const local = url => decodeURIComponent(url).includes('@lt/');


describe('discovery: members inside and outside the root (criterion 1)', () => {
	let layout;
	before(() => {
		layout = new Layout('discovery');
		['workspace', 'repositories', 'forms'].forEach(group => layout.copy(group));
	});
	after(() => layout?.remove());

	test('the npm workspace declares its members in order, the one outside the root by the Beyond extension', BOUND, () => {
		const root = layout.path('workspace');
		const outside = layout.path('repositories', 'message-v2');
		const declaration = Declaration.read(root);
		assert.equal(declaration.valid, true, explain(declaration.diagnostics));
		assert.deepEqual([declaration.kind, declaration.root], ['npm', root]);
		assert.deepEqual(declaration.members.map(({ id, name, version, source }) => [id, `${name}@${version}`, source]), [
			['apps/app', '@lt/app@1.0.0', 'workspaces'],
			['apps/app18', '@lt/app18@1.0.0', 'workspaces'],
			['packages/banner', '@lt/banner@1.0.0', 'workspaces'],
			['packages/counter-view', '@lt/counter-view@1.0.0', 'workspaces'],
			['packages/message', '@lt/message@1.0.0', 'workspaces'],
			['../repositories/message-v2', '@lt/message@2.0.0', 'beyond.workspaces']
		]);
		assert.equal(declaration.members.at(-1).path, outside);
		assert.equal(declaration.member(outside)?.id, '../repositories/message-v2');
		assert.equal(declaration.owner(join(outside, 'text', 'index.ts'))?.id, '../repositories/message-v2');
		assert.equal(declaration.owner(join(root, 'packages', 'drafts')), undefined, 'excluded by its negated pattern');

		// The inputs the lock records, recomputed from their definition
		const { manifest } = declaration.member(join(root, 'packages', 'banner'));
		const { name, version, dependencies } = manifest;
		assert.equal(declaration.inputs.members['packages/banner'], Canonical.digest({ name, version, dependencies }));
		const members = declaration.members.map(({ id, name, version }) => ({ id, name, version }));
		members.sort((a, b) => (a.id < b.id ? -1 : 1));
		const content = { kind: 'npm', members, root: { devDependencies: { scheduler: '^0.26.0' } } };
		assert.equal(declaration.inputs.declaration, Canonical.digest(content));
	});

	test('every form is read: the npm object form, Beyond patterns, beyond.json and a standalone package', BOUND, () => {
		const object = Declaration.read(layout.path('forms', 'object'));
		assert.deepEqual([object.kind, object.valid], ['npm', true], explain(object.diagnostics));
		const ids = object.members.map(({ id, source, path }) => [id, source, path]);
		assert.deepEqual(ids, [
			['members/one', 'workspaces', layout.path('forms', 'object', 'members', 'one')],
			['../outside/tool', 'beyond.workspaces', layout.path('forms', 'outside', 'tool')]
		]);
		const configured = Declaration.read(layout.path('forms', 'beyond-json'));
		assert.deepEqual([configured.kind, configured.valid], ['beyond-json', true], explain(configured.diagnostics));
		assert.deepEqual(configured.members.map(({ id, name, source }) => [id, name, source]), [['one', '@forms/one', 'beyond.json']]);
		const standalone = Declaration.read(layout.path('forms', 'standalone'));
		assert.deepEqual([standalone.kind, standalone.valid], ['standalone', true], explain(standalone.diagnostics));
		const [only] = standalone.members;
		assert.deepEqual([only.id, only.name, only.source, only.path], ['.', '@forms/standalone', 'standalone', layout.path('forms', 'standalone')]);
	});

	test('a conflicting, duplicated or contradicted declaration is refused with its code', BOUND, () => {
		const refused = (directory, code) => {
			const declaration = Declaration.read(layout.path(directory));
			assert.equal(declaration.valid, false, `${directory} must be refused`);
			const found = declaration.diagnostics.find(diagnostic => diagnostic.code === code);
			assert.ok(found, `${code} expected: ${explain(declaration.diagnostics)}`);
			return found;
		};
		refused('forms/conflict', 'WORKSPACE_CONFIG_CONFLICT');
		refused('forms/duplicated', 'WORKSPACE_NAME_DUPLICATED');

		// Short edits of the copy: a version assertion the manifest contradicts, a directory that does not exist,
		// and one name@version at two directories
		const entry = 'workspace/package.json';
		layout.edit(entry, manifest => (manifest.beyond.workspaces[0].version = '2.1.0'));
		refused('workspace', 'MEMBER_VERSION_MISMATCH');
		layout.edit(entry, manifest => (manifest.beyond.workspaces[0] = { path: '../repositories/message-v3' }));
		refused('workspace', 'MEMBER_NOT_FOUND');
		layout.copy('workspace/packages/message', 'repositories/message-copy');
		layout.edit(entry, manifest => (manifest.beyond.workspaces[0] = { path: '../repositories/message-copy' }));
		const twice = explain(refused('workspace', 'WORKSPACE_INSTANCE_DUPLICATED'));
		for (const path of [layout.path('workspace', 'packages', 'message'), layout.path('repositories', 'message-copy')]) {
			assert.ok(twice.includes(path), `${path} named by ${twice}`);
		}
		layout.restore(entry);
		assert.equal(Declaration.read(layout.path('workspace')).valid, true, 'valid again once corrected');
	});

	test('a command finds the workspace from a member inside the root; a member outside needs --workspace', BOUND, () => {
		const root = layout.path('workspace');
		const outside = layout.path('repositories', 'message-v2');
		const inside = new Context({ directory: layout.path('workspace', 'apps', 'app', 'main') });
		assert.deepEqual([inside.root, inside.standalone, inside.declaration?.kind], [root, false, 'npm']);
		const alone = new Context({ directory: outside });
		assert.deepEqual([alone.root, alone.standalone], [outside, true]);
		const explicit = new Context({ directory: outside, workspace: root });
		assert.deepEqual([explicit.root, explicit.standalone], [root, false]);
		assert.equal(explicit.declaration.owner(explicit.directory)?.id, '../repositories/message-v2');
		const excluded = () => new Context({ directory: layout.path('workspace', 'packages', 'drafts') });
		assert.throws(excluded, { code: 'CONTEXT_NOT_MEMBER' });
	});
});

describe('installation: the graph first, local names never requested (criteria 2, 4 and 5)', () => {
	const scenario = new Scenario('install');
	let outside, first, events, log, lock;
	before(async () => {
		await scenario.open();
		outside = new Snapshot(scenario.layout.path('repositories'));
	});
	after(() => scenario.close());

	test('the first installation resolves the whole workspace and fetches only its external closure', BOUND, async () => {
		const project = scenario.workspace;
		first = await project.install();
		[events, log] = [scenario.recorder.events, [...scenario.registry.log]];
		assert.equal(first.valid, true, explain(first.diagnostics));
		assert.deepEqual([first.protocol, first.frozen], ['beyond-installation/1', false]);
		const paths = [first.lock.path, first.lock.written, first.execution.path, first.execution.written];
		assert.deepEqual(paths, [project.path('beyond-lock.json'), true, project.path('.beyond', 'execution.json'), true]);
		lock = project.lock();
		assert.equal(first.lock.digest, lock.document.digest);
		assert.deepEqual(lock.graph.releases, RELEASES);
		const { members, nodes } = lock.document;
		const counts = { members: Object.keys(members).length, nodes: Object.keys(nodes).length, fetched: RELEASES.length, reused: 0 };
		assert.deepEqual(first.counts, counts);
		assert.deepEqual(first.diagnostics.filter(({ severity }) => severity === 'error'), []);
	});

	test('no metadata or archive of a local name is requested, though the registry offers newer ones', BOUND, () => {
		assert.ok(first?.valid, 'the first installation succeeded');
		assert.deepEqual(log.filter(({ path }) => local(path)), []);
		assert.deepEqual(events.filter(({ url }) => local(url)), []);
		for (const name of ['@lt/app', '@lt/app18', '@lt/banner', '@lt/counter-view', '@lt/message']) {
			for (const key of lock.graph.keys(name)) assert.equal(lock.graph.local(key), true, `${key} is a member`);
		}
		assert.deepEqual(lock.graph.versions('@lt/message'), ['1.0.0', '2.0.0']);
		assert.equal(log.filter(({ type }) => type === 'tarball').length, RELEASES.length, 'one archive per external node');
	});

	test('the graph is complete before the first archive is requested', BOUND, () => {
		assert.ok(first?.valid, 'the first installation succeeded');
		const archive = events.findIndex(({ type, kind }) => type === 'start' && kind === 'archive');
		const settled = events.findLastIndex(({ type, kind }) => type === 'end' && kind === 'metadata');
		assert.ok(settled >= 0, 'metadata requests go through the given transport');
		assert.ok(archive > settled, `last metadata answer at ${settled}, first archive at ${archive}: ${explain(events)}`);
		const archives = events.filter(({ type, kind }) => type === 'start' && kind === 'archive').map(({ url }) => url);
		const pinned = lock.graph.external.map(key => lock.document.nodes[key].tarball);
		assert.deepEqual(archives.sort(), pinned.sort());
	});

	test('the lock holds members, per-consumer edges, the alias, peer contexts and origins, and nothing of this machine', BOUND, () => {
		assert.ok(first?.valid, 'the first installation succeeded');
		const { document, text, graph } = lock;
		assert.equal(document.protocol, 'beyond-lock/2');
		assert.deepEqual(document.inputs, scenario.workspace.declaration().inputs);
		const versions = { [ROOT]: 'lt-workspace@0.0.0', [MESSAGE2]: '@lt/message@2.0.0', [MESSAGE]: '@lt/message@1.0.0' };
		for (const [id, { name, version, node }] of Object.entries(document.members)) {
			assert.equal(node, Graph.member(id));
			if (versions[node]) assert.equal(`${name}@${version}`, versions[node]);
		}
		assert.deepEqual(Object.keys(document.members).sort(), ['.', ...MEMBERS].sort());
		for (const id of ['.', ...MEMBERS]) {
			const { origin, member, visibility, integrity, tarball } = document.nodes[Graph.member(id)];
			const expected = { origin: { provider: 'workspace' }, member: id, visibility: 'public', integrity: null, tarball: null };
			assert.deepEqual({ origin, member, visibility, integrity, tarball }, expected);
		}
		for (const key of graph.external) {
			const { name, version, origin, visibility, integrity, tarball } = document.nodes[key];
			assert.ok(key.endsWith(`:${name}@${version}`) && /^registry-/.test(origin.provider), key);
			assert.deepEqual([origin.registry, visibility], [`${scenario.registry.url}/`, 'public']);
			assert.equal(integrity, scenario.registry.release(name, version).integrity);
			assert.equal(tarball, `${scenario.registry.url}/${name}/-/${basename(name)}-${version}.tgz`);
		}

		// Two versions of one name consumed at once, each by its own consumers
		assert.equal(graph.edge(APP, '@lt/message').to, MESSAGE);
		assert.equal(graph.edge(BANNER, '@lt/message').to, MESSAGE2);
		assert.equal(graph.edge(APP18, '@lt/message').to, MESSAGE2, 'workspace:* is the highest member version');
		assert.equal(graph.edge(APP, '@lt/banner').to, BANNER);
		// The alias keeps its declared name and reaches the release react-dom 18 shares
		const alias = graph.edge(BANNER, 'legacy-scheduler');
		assert.deepEqual([alias.name, graph.target(alias)], ['legacy-scheduler', 'scheduler@0.23.2']);
		assert.equal(alias.to, graph.edge(graph.key('react-dom', '18.3.1'), 'scheduler').to);
		// Peers: the importer's own peer, without a context, and one context per application that reaches it
		const reached = (from, context) => graph.target(graph.edge(from, 'react', context));
		assert.deepEqual([reached(VIEW), graph.edge(VIEW, 'react').kind], ['react@19.1.1', 'peer']);
		assert.deepEqual([reached(VIEW, APP), reached(VIEW, APP18)], ['react@19.1.1', 'react@18.3.1']);
		for (const [from, context, target] of [['react-dom@19.1.1', APP, 'react@19.1.1'], ['react-dom@18.3.1', APP18, 'react@18.3.1'], ['use-store@1.0.0', APP, 'react@19.1.1'], ['use-store@1.0.0', APP18, 'react@18.3.1']]) {
			const edge = graph.edge(graph.key(...from.split('@')), 'react', context);
			assert.deepEqual([edge.kind, graph.target(edge)], ['peer', target], `${from} in ${context}`);
		}
		// The root importer's development dependency is a build edge
		assert.deepEqual([graph.target(graph.edge(ROOT, 'scheduler')), graph.edge(ROOT, 'scheduler').kind], ['scheduler@0.26.0', 'build']);

		// Portable and reproducible: no path of this machine, canonical text, a digest of its own content
		for (const path of [tmpdir(), scenario.layout.directory]) assert.ok(!text.includes(path), `the lock names ${path}`);
		assert.deepEqual(Object.keys(document).sort(), ['digest', 'edges', 'exceptions', 'inputs', 'members', 'nodes', 'overrides', 'protocol']);
		assert.equal(text, Canonical.pretty(document));
		const { digest, ...content } = document;
		assert.equal(digest, Canonical.digest(content));
	});

	test('the projection is ready, locates every node and answers every edge of the lock', BOUND, async () => {
		assert.ok(first?.valid, 'the first installation succeeded');
		const project = scenario.workspace;
		const read = await project.read();
		assert.equal(read.state, 'ready', explain(read.diagnostics));
		const { execution } = read;
		const { document, graph } = lock;
		assert.deepEqual([execution.root, execution.lock, execution.inputs], [project.root, document.digest, document.inputs]);
		assert.equal(execution.members.get('../repositories/message-v2').location, scenario.layout.path('repositories', 'message-v2'));
		assert.equal(execution.members.get('apps/app').location, project.path('apps', 'app'));
		for (const key of graph.external) {
			const { location, name, version } = execution.node(key);
			assert.ok(location.startsWith(scenario.store + sep), `${key} is located in the store: ${location}`);
			const manifest = JSON.parse(readFileSync(join(location, 'package.json'), 'utf8'));
			assert.equal(`${manifest.name}@${manifest.version}`, `${name}@${version}`);
		}
		for (const edge of document.edges.filter(({ to }) => to)) {
			const answer = execution.resolve(edge.from, graph.declared(edge), edge.context);
			assert.equal(answer.key, edge.to, `${edge.from} -> ${graph.declared(edge)} (${edge.context}): ${explain(answer)}`);
		}
		// A node resolves itself by its own name, and the two versions of one name stay apart
		assert.deepEqual([execution.resolve(MESSAGE, '@lt/message').key, execution.resolve(MESSAGE2, '@lt/message').key], [MESSAGE, MESSAGE2]);
		assert.deepEqual(execution.find('@lt/message').sort(), [MESSAGE2, MESSAGE].sort());
		assert.deepEqual(execution.find('@lt/message', '2.0.0'), [MESSAGE2]);
		assert.equal(execution.instance(scenario.layout.path('repositories', 'message-v2')), MESSAGE2);
		const react = graph.key('react', '19.1.1');
		assert.equal(execution.instance(execution.node(react).location), react);
		// Never a guess by name: an import nobody declared, and a peer only a context decides
		assert.equal(execution.resolve(MESSAGE, 'react').error?.code, 'DEPENDENCY_NOT_INSTALLED');
		assert.equal(execution.resolve(graph.key('use-store', '1.0.0'), 'react').error?.code, 'PEER_CONTEXT_AMBIGUOUS');
	});

	test('app and app18 bind the React of one counter view by their own context, one React per renderer pair', BOUND, async () => {
		const { execution } = await scenario.workspace.read();
		assert.ok(execution, 'the projection is read');
		for (const [application, version] of [[APP, '19.1.1'], [APP18, '18.3.1']]) {
			const own = execution.resolve(application, 'react');
			const renderer = execution.resolve(application, 'react-dom');
			assert.deepEqual([own.node?.version, renderer.node?.version], [version, version]);
			assert.equal(execution.resolve(VIEW, 'react', application).key, own.key, `the view in ${application}`);
			assert.equal(execution.resolve(renderer.key, 'react', application).key, own.key, `the renderer in ${application}`);
		}
	});

	test('a frozen reinstall requests nothing, reuses every source and keeps the lock byte for byte', BOUND, async () => {
		const project = scenario.workspace;
		const previous = project.files();
		scenario.reset();
		const again = await project.install();
		assert.equal(again.valid, true, explain(again.diagnostics));
		assert.deepEqual([again.frozen, again.lock.written, again.counts.fetched, again.counts.reused], [true, false, 0, RELEASES.length]);
		assert.deepEqual([scenario.recorder.events, scenario.registry.log], [[], []]);
		assert.equal(project.files().lock, previous.lock);
		assert.equal((await project.read()).state, 'ready');
	});

	test('the same workspace resolved from scratch elsewhere gives the same lock byte for byte, from stored sources', BOUND, async () => {
		const { layout } = scenario;
		['workspace', 'repositories'].forEach(group => layout.copy(group, join('elsewhere', group)));
		const elsewhere = scenario.project(join('elsewhere', 'workspace'));
		scenario.reset();
		const report = await elsewhere.install();
		assert.equal(report.valid, true, explain(report.diagnostics));
		assert.deepEqual([report.frozen, report.counts.fetched, report.counts.reused], [false, 0, RELEASES.length]);
		assert.equal(scenario.registry.requests.tarball, 0);
		assert.equal(elsewhere.files().lock, lock.text);
		const { execution } = await elsewhere.read();
		assert.equal(execution?.members.get('../repositories/message-v2').location, layout.path('elsewhere', 'repositories', 'message-v2'));
	});

	test('a second project sharing the store keeps its own React patch and the scheduler stored once', BOUND, async () => {
		const second = scenario.project('second');
		const workspace = scenario.workspace.files();
		scenario.reset();
		const report = await second.install();
		assert.equal(report.valid, true, explain(report.diagnostics));
		assert.deepEqual([report.counts.fetched, report.counts.reused], [1, 1]);
		assert.deepEqual(scenario.recorder.requests('archive').map(url => basename(url)), ['react-19.0.0.tgz']);
		assert.deepEqual(second.lock().graph.releases, ['react@19.0.0', 'scheduler@0.26.0']);
		const [mine, theirs] = [await second.read(), await scenario.workspace.read()];
		assert.deepEqual([mine.state, theirs.state], ['ready', 'ready']);
		const [react, own] = [mine.execution.resolve(ROOT, 'react').node, theirs.execution.resolve(APP, 'react').node];
		assert.deepEqual([react.version, own.version], ['19.0.0', '19.1.1']);
		assert.ok(react.location !== own.location && existsSync(react.location) && existsSync(own.location));
		const scheduler = [mine.execution.resolve(ROOT, 'scheduler'), theirs.execution.resolve(ROOT, 'scheduler')];
		assert.equal(scheduler[0].node.location, scheduler[1].node.location, 'one stored copy for both projects');
		assert.deepEqual(scenario.workspace.files(), workspace, 'the workspace lock and projection are untouched');
	});

	test('offline, a frozen workspace whose sources are stored installs without a single request', BOUND, async () => {
		scenario.reset();
		const report = await scenario.workspace.install({ offline: true });
		assert.equal(report.valid, true, explain(report.diagnostics));
		assert.equal(report.frozen, true);
		assert.deepEqual([scenario.recorder.events, scenario.registry.log], [[], []]);
		assert.equal((await scenario.workspace.read()).state, 'ready');
	});

	test('no installation of the group wrote into the members, and no node_modules directory appeared', BOUND, () => {
		assert.ok(first?.valid, 'the first installation succeeded');
		assert.deepEqual(new Snapshot(scenario.layout.path('repositories')).entries, outside.entries);
		const written = new Snapshot(scenario.workspace.root);
		assert.deepEqual([written.named('node_modules'), new Snapshot(scenario.layout.path('second')).named('node_modules')], [[], []]);
		assert.deepEqual([written.named('.beyond'), written.named('beyond-lock.json')], [['.beyond'], ['beyond-lock.json']]);
	});
});

describe('consumption: the Packages workspace follows each importer\'s edges (criteria 3 and 4)', () => {
	const scenario = new Scenario('consumption');
	let execution;
	before(async () => {
		await scenario.open();
		const report = await scenario.workspace.install();
		assert.equal(report.valid, true, explain(report.diagnostics));
		({ execution } = await scenario.workspace.read());
	});
	after(() => scenario.close());

	test('each importer reaches its own instance of a name two members hold; without the graph none is guessed', BOUND, async t => {
		const { Workspace } = await import('@beyond-js/packages/workspace');
		const declaration = scenario.workspace.declaration();
		const members = declaration.members.map(({ id, path }) => ({ id, path }));
		const workspace = new Workspace(declaration.root, { members, execution });
		t.after(() => workspace.destroy());
		await workspace.ready;
		const pkg = async id => {
			const found = workspace.packages.get(id);
			await found.ready;
			return found;
		};
		const [app, app18, banner] = [await pkg('apps/app'), await pkg('apps/app18'), await pkg('packages/banner')];
		const at = importer => workspace.resolve('@lt/message/text', importer);
		assert.deepEqual([at(app)?.package.path, at(app)?.subpath], [scenario.workspace.path('packages', 'message'), './text']);
		for (const importer of [app18, banner]) assert.equal(at(importer)?.package.path, scenario.layout.path('repositories', 'message-v2'));
		assert.equal(workspace.resolve('react', app), undefined, 'an external package is not a workspace package');
		assert.equal(workspace.imports.resolve('react', app).node?.version, '19.1.1');
		assert.equal(workspace.imports.resolve('react', app18).node?.version, '18.3.1');
		assert.equal(workspace.imports.resolve('scheduler', app).error?.code, 'DEPENDENCY_NOT_INSTALLED');

		// Without the graph, names decide: every package is processed before a name is judged
		const flat = new Workspace(declaration.root, { members });
		t.after(() => flat.destroy());
		await flat.ready;
		await Promise.all([...flat.packages.values()].map(one => one.ready));
		const importer = flat.packages.get('apps/app');
		assert.equal(flat.resolve('@lt/message/text', importer), undefined, 'never the first of two versions');
		assert.equal(flat.imports.resolve('@lt/message/text', importer).error?.code, 'PACKAGE_AMBIGUOUS');
	});
});
