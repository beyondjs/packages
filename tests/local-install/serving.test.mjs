/**
 * The routes that hand an installed graph to a browser (`/resolution.json`, `/importmap.json`, the preview of
 * `@beyond-js/packages/development`) over a real delivery of a workspace built from its members and the projection of
 * its installed graph (`fixtures/serving`, read its README): importers are instances, peers are bound by the instances
 * that reached them, the runtime is the page's, every node is served here under its provider, and a document that
 * cannot hold a binding is refused. No CDN origin is needed for any of it. The harness is `support/serving.mjs`.
 *
 * It needs `BEE_URL` and the loader of `BEE_NODE_DIR` (see `tests/stage-1/README.md`); no watcher is needed:
 *
 * ```sh
 * BEE_URL=http://localhost:1112,… node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/serving.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Resolution } from '@beyond-js/artifact-api';
import { QUERY, REGISTRY, Served, codes, module, table } from './support/serving.mjs';

const CDN = 'BEYOND_CDN_ORIGIN';
const configured = process.env[CDN];
delete process.env[CDN];
after(() => (configured === void 0 ? delete process.env[CDN] : (process.env[CDN] = configured)));

test('resolution: each import bound by its importer\'s edges, another local version in a scope, the store under its registry', async t => {
	const served = await Served.start(t, ['message-v1', '../outside/message-v2', 'app-b']);
	const response = await served.get('/resolution.json?target=browser&format=esm');
	assert.equal(response.status, 200, await response.clone().text());
	assert.equal(response.headers.get('cache-control'), 'no-store');
	const resolution = Resolution.parse(await response.text());

	assert.match(REGISTRY, /^registry-packages-example-test-npm-[0-9a-f]{32}$/, 'the id the resolution gives the registry, which the projection records');
	assert.deepEqual(table(resolution.imports), {
		'@serving/app-b/main': module('/m/@serving/app-b@1.0.0', 'main'),
		kit: module('/m/kit@1.0.0'),
		ping: module('/m/ping@1.0.0'),
		pong: module('/m/pong@1.0.0'),
		react: module('/m/react@19.1.0'),
		shared: module('/m/shared@1.0.0'),
		'shared.css': `/m/shared@1.0.0/styles/~root?${QUERY}`,
		toolkit: module(`/m/${REGISTRY}/toolkit@2.0.0`)
	});
	// Two local versions publish `@serving/message/main`: neither is the import, and the application gets its own in its
	// scope. The library's peer is the React of the application that reached it, directly or through kit, which provides
	// none; ping and pong import each other and are walked once each
	assert.deepEqual(table(resolution.scopes), { '/m/@serving/app-b@1.0.0/': { '@serving/message/main': module('/m/@serving/message@2.0.0', 'main') } });

	// Every address is a module this service delivers, from the member's directory or the store
	for (const [specifier, url] of [...resolution.imports, ...resolution.scopes.get('/m/@serving/app-b@1.0.0/')]) {
		assert.equal((await served.get(url)).status, 200, `${specifier}: ${url}`);
	}
	assert.match(await (await served.get(resolution.resolve('react', '/m/shared@1.0.0/modules/~root'))).text(), /19\.1\.0 from the store/);
	assert.match(await (await served.get(resolution.resolve('@serving/message/main', '/m/@serving/app-b@1.0.0/modules/main'))).text(), /message 2\.0\.0/);

	// The import map is the same resolution, relative to the document
	const map = await (await served.get('/importmap.json?target=browser&format=esm')).json();
	assert.deepEqual(map, resolution.importmap());

	// Nothing was installed into the workspace: the store is read where the projection says it is
	for (const directory of ['', 'app-b']) await assert.rejects(stat(join(served.root, directory, 'node_modules')), { code: 'ENOENT' });
});

test('resolution: one document cannot give one release two releases of its peer (PEER_CONTEXT_AMBIGUOUS)', async t => {
	const served = await Served.start(t);
	for (const path of ['/resolution.json?target=browser&format=esm', '/importmap.json?target=browser&format=system']) {
		const { status, body } = await served.json(path);
		assert.deepEqual([status, body.error.code], [422, 'BUILD_FAILED'], path);
		// app-a/loose imports what its graph does not provide, which no document can leave out either
		assert.deepEqual(codes(body.error.diagnostics).sort(), ['DEPENDENCY_NOT_INSTALLED', 'PEER_CONTEXT_AMBIGUOUS'], path);
		const diagnostic = body.error.diagnostics.find(({ code }) => code === 'PEER_CONTEXT_AMBIGUOUS');
		assert.match(diagnostic.message, /"shared@1\.0\.0" imports "react" as \/m\/react@18\.3\.1\/modules\/~root through "@serving\/app-a@1\.0\.0" and as \/m\/react@19\.1\.0\/modules\/~root through "@serving\/app-b@1\.0\.0"/, path);
	}

	// The refusal is of that document: the modules of the graph, and each application's own page, are still served
	assert.equal((await served.get(module('/m/react@18.3.1'))).status, 200);
	assert.equal((await served.json('/preview/entry.json?entry=@serving/app-a/main')).status, 200);
});

test('sources: a request names the source of a node of the installed graph, and only it', async t => {
	const served = await Served.start(t);
	assert.equal((await served.get(module(`/m/${REGISTRY}/toolkit@2.0.0`))).status, 200);
	assert.equal((await served.get(module('/m/react@18.3.1'))).status, 200, 'a node no document of this workspace binds is still delivered');

	const expectations = [
		['/m/toolkit@2.0.0', 'PACKAGE_NOT_FOUND', 'the npm path does not deliver what another registry published'],
		[`/m/${REGISTRY}/react@19.1.0`, 'PACKAGE_NOT_FOUND', 'nor another registry what npm published'],
		[`/m/${REGISTRY}/toolkit@9.9.9`, 'VERSION_MISMATCH', 'another version of a package the graph has from that registry'],
		[`/m/${REGISTRY}/@serving/message@1.0.0`, 'PACKAGE_NOT_FOUND', 'a member of the workspace belongs to no registry', 'main'],
		['/m/tool@1.0.0', 'SOURCE_UNSUPPORTED', 'a node taken from Git has no registry address']
	];
	for (const [path, code, why, subpath] of expectations) {
		const { status, body } = await served.json(module(path, subpath));
		assert.equal(body.error.code, code, `${path}: ${why}`);
		assert.equal(status, code === 'SOURCE_UNSUPPORTED' ? 501 : 404, path);
	}
	assert.equal((await served.json(module('/m/react@17.0.0'))).status, 404, 'a release the graph does not have is looked for nowhere else');
});

test('preview: each application gets its page, with its own React, its own version of a local name and no CDN', async t => {
	const served = await Served.start(t);
	const a = await served.preview('@serving/app-a/main');
	assert.equal(a.status, 200, JSON.stringify(a.body));
	assert.deepEqual(a.body.importmap, {
		imports: {
			'@serving/app-a/main': `..${module('/m/@serving/app-a@1.0.0', 'main')}`,
			'@serving/message/main': `..${module('/m/@serving/message@1.0.0', 'main')}`,
			react: `..${module('/m/react@18.3.1')}`,
			shared: `..${module('/m/shared@1.0.0')}`,
			'shared.css': `../m/shared@1.0.0/styles/~root?${QUERY}`
		}
	});
	assert.deepEqual(a.body.diagnostics, []);
	assert.match(a.body.cdn.reason, /BEYOND_CDN_ORIGIN is not set, and no module of the installed graph needs it/);
	assert.deepEqual(a.body.modules.map(({ specifier, version, source }) => `${specifier}@${version} ${source}`), [
		'@serving/app-a/main@1.0.0 environment',
		'@serving/message/main@1.0.0 environment',
		'react@18.3.1 environment',
		'shared@1.0.0 environment'
	]);
	assert.equal(a.body.modules.find(({ specifier }) => specifier === 'shared').scope, 'document', 'the document holds the library\'s sheet');

	const b = await served.preview('@serving/app-b/main');
	assert.equal(b.status, 200, JSON.stringify(b.body));
	// shared is reached directly and through kit, and binds React 19 both ways: kit, which reached it, provides no
	// React, so the peer is the one of the application that reached kit
	assert.deepEqual(b.body.importmap, {
		imports: {
			'@serving/app-b/main': `..${module('/m/@serving/app-b@1.0.0', 'main')}`,
			'@serving/message/main': `..${module('/m/@serving/message@2.0.0', 'main')}`,
			kit: `..${module('/m/kit@1.0.0')}`,
			ping: `..${module('/m/ping@1.0.0')}`,
			pong: `..${module('/m/pong@1.0.0')}`,
			react: `..${module('/m/react@19.1.0')}`,
			shared: `..${module('/m/shared@1.0.0')}`,
			'shared.css': `../m/shared@1.0.0/styles/~root?${QUERY}`,
			toolkit: `..${module(`/m/${REGISTRY}/toolkit@2.0.0`)}`
		}
	});
	assert.deepEqual(b.body.diagnostics, []);

	// Each address is delivered by this environment, relative to the document
	const base = new URL('/preview/', served.origin);
	for (const { specifier, url } of b.body.modules.filter(({ source }) => source === 'environment')) {
		assert.equal((await served.get(new URL(url, base))).status, 200, `${specifier}: ${url}`);
	}

	const html = await (await served.get('/preview/?entry=@serving/app-b/main')).text();
	assert.ok(html.includes('<script type="importmap">') && html.includes('await import("@serving/app-b/main");'));
	assert.ok(html.includes(`<link rel="stylesheet" data-beyond-styles="shared@1.0.0" href="../m/shared@1.0.0/styles/~root?${QUERY.replace(/&/g, '&amp;')}">`));
	assert.ok(!/127\.0\.0\.1|localhost/.test(html), 'the document names no origin');
});

test('preview: a page that reaches both applications is refused (PEER_CONTEXT_AMBIGUOUS), and each one is still served', async t => {
	const served = await Served.start(t);
	for (const path of ['/preview/entry.json?entry=@serving/both/main', '/preview/?entry=@serving/both/main']) {
		const { status, body } = await served.json(path);
		assert.deepEqual([status, body.error.code], [409, 'PEER_CONTEXT_AMBIGUOUS'], path);
		assert.deepEqual(codes(body.error.diagnostics), ['PEER_CONTEXT_AMBIGUOUS']);
		const [{ message }] = body.error.diagnostics;
		assert.match(message, /the package at \.\.\/m\/shared@1\.0\.0\/ imports "react" as \.\.\/m\/react@18\.3\.1\/modules\/~root through "@serving\/app-a\/main" and as \.\.\/m\/react@19\.1\.0\/modules\/~root through "@serving\/app-b\/main"/);
	}

	// Recovery: refusing one page leaves nothing behind
	for (const entry of ['@serving/app-a/main', '@serving/app-b/main']) assert.equal((await served.preview(entry)).status, 200, entry);
});

test('preview: two local versions of one name are told apart by version, never by the first one found', async t => {
	const served = await Served.start(t);
	const ambiguous = await served.preview('@serving/message/main');
	assert.deepEqual([ambiguous.status, ambiguous.body.error.code], [409, 'PREVIEW_ENTRY_REQUIRED']);
	assert.deepEqual(ambiguous.body.error.candidates, ['@serving/message@1.0.0/main', '@serving/message@2.0.0/main']);

	const second = await served.preview('@serving/message@2.0.0/main');
	assert.equal(second.status, 200);
	assert.deepEqual(second.body.entry, { specifier: '@serving/message/main', vspecifier: '@serving/message@2.0.0/main' });
	assert.deepEqual(second.body.importmap.imports, { '@serving/message/main': `..${module('/m/@serving/message@2.0.0', 'main')}` });
});

test('preview: a node of the graph is served by the environment whatever the selection and the CDN origin say', async t => {
	process.env[CDN] = 'https://cdn.example.test';
	t.after(() => delete process.env[CDN]);
	const served = await Served.start(t);
	const replaced = await served.json('/development/selection', { method: 'PUT', body: JSON.stringify({ packages: ['@serving/app-a'] }) });
	assert.deepEqual(replaced.body, { explicit: true, packages: ['@serving/app-a'], modules: [], unknown: [] });

	const { status, body } = await served.preview('@serving/app-a/main');
	assert.equal(status, 200);
	assert.equal(body.cdn.origin, 'https://cdn.example.test');
	const message = body.modules.find(({ specifier }) => specifier === '@serving/message/main');
	assert.deepEqual([message.source, message.url], ['environment', `..${module('/m/@serving/message@1.0.0', 'main')}`], 'a member that is not selected is a node of the graph');
	assert.deepEqual(Object.values(body.importmap.imports).filter(url => url.startsWith('https:')), [], 'nothing is asked of the CDN');
	assert.deepEqual(body.diagnostics, []);
});

test('preview: an import its graph does not provide has no address, and the page says why', async t => {
	const served = await Served.start(t);
	const { status, body } = await served.preview('@serving/app-a/loose');
	assert.equal(status, 200, JSON.stringify(body));
	const phantom = body.modules.find(({ specifier }) => specifier === 'phantom');
	assert.equal(phantom.source, 'unresolved');
	assert.match(phantom.reason, /npm:loose@1\.0\.0 imports phantom, which its graph does not provide/);
	assert.deepEqual(codes(body.diagnostics), ['DEPENDENCY_NOT_INSTALLED']);
	assert.equal(body.importmap.imports.phantom, undefined, 'no address is invented');
	assert.equal(body.modules.find(({ specifier }) => specifier === 'loose').source, 'environment');

	// Its importer's scope maps it to a module that throws why, so it cannot take the address another importer was given
	const failing = decodeURIComponent(body.importmap.scopes['../m/loose@1.0.0/'].phantom);
	assert.match(failing, /^data:text\/javascript,throw new Error\("\[beyond preview\] DEPENDENCY_NOT_INSTALLED: \\"phantom\\" has no address: npm:loose@1\.0\.0 imports phantom/);
});

test('peers: a library bound to React 19 on its own takes the React of the application that reaches it', async t => {
	const served = await Served.start(t, ['ui-lib', 'app-d', 'app-e']);
	const versions = page => page.body.modules.filter(({ specifier }) => specifier === 'react').map(({ version }) => version);

	// Reached from the application on React 18 the library's own binding (React 19, no context) is not taken
	const d = await served.preview('@serving/app-d/main');
	assert.equal(d.status, 200, JSON.stringify(d.body));
	assert.deepEqual(versions(d), ['18.3.1'], 'one React in the page');
	assert.equal(d.body.importmap.imports.react, `..${module('/m/react@18.3.1')}`);
	assert.equal(d.body.importmap.scopes, undefined, 'the library needs no React of its own');

	// The application on React 19, and the library developed on its own, which binds its own peer
	for (const entry of ['@serving/app-e/main', '@serving/ui-lib/main']) assert.deepEqual(versions(await served.preview(entry)), ['19.1.0'], entry);

	// One document of the whole workspace would give the library both
	const { status, body } = await served.json('/resolution.json?target=browser&format=esm');
	assert.deepEqual([status, body.error.code, codes(body.error.diagnostics)], [422, 'BUILD_FAILED', ['PEER_CONTEXT_AMBIGUOUS']]);
});

test('runtime: an import of the bundler runtime reaches the runtime of the page, the one its application declares', async t => {
	const served = await Served.start(t, ['runtime', 'runtime-v2', 'lib', 'app-c']);
	const page = await served.preview('@serving/app-c/main');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	assert.deepEqual(page.body.diagnostics, []);
	assert.equal(page.body.importmap.imports['@serving/runtime/bundle'], `..${module('/m/@serving/runtime@1.0.0', 'bundle')}`, 'the application declares it');
	assert.ok(!JSON.stringify(page.body.importmap).includes('@serving/runtime@2.0.0'), 'one runtime for the page');

	// A page whose application declares no runtime has two to choose from, and chooses neither
	const library = await served.preview('@serving/lib/main');
	const missing = library.body.modules.find(({ specifier }) => specifier === '@serving/runtime/bundle');
	assert.equal(missing.source, 'unresolved');
	assert.match(missing.reason, /^"@serving\/runtime" is the runtime of "@serving\/lib@1\.0\.0\/main"; declare it in the application "@serving\/lib" and run beyond install \(the installed graph has 2 instances/);
	assert.deepEqual(codes(library.body.diagnostics), ['RUNTIME_NOT_INSTALLED']);

	// Nor does a resolution of the whole workspace, which has no application
	const { status, body } = await served.json('/resolution.json?target=browser&format=esm');
	assert.deepEqual([status, body.error.code, codes(body.error.diagnostics)], [422, 'BUILD_FAILED', ['RUNTIME_NOT_INSTALLED']]);
});

test('runtime: the only runtime of the installed graph serves the whole workspace; a runtime it does not have is refused', async t => {
	const single = await Served.start(t, ['runtime', 'lib', 'app-c']);
	const resolution = Resolution.parse(await (await single.get('/resolution.json?target=browser&format=esm')).text());
	assert.equal(resolution.resolve('@serving/runtime/bundle', '/m/@serving/lib@1.0.0/modules/main'), module('/m/@serving/runtime@1.0.0', 'bundle'));

	const orphan = await Served.start(t, ['orphan']);
	const page = await orphan.preview('@serving/orphan/main');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	const missing = page.body.modules.find(({ specifier }) => specifier === '@serving/absent/bundle');
	assert.equal(missing.source, 'unresolved');
	assert.match(missing.reason, /\(the installed graph does not have it\)$/);
	assert.deepEqual(codes(page.body.diagnostics), ['RUNTIME_NOT_INSTALLED']);
	assert.equal(page.body.importmap.imports['@serving/absent/bundle'], undefined, 'nothing stands in for it, the toolchain\'s runtime included');

	const { status, body } = await orphan.json('/resolution.json?target=browser&format=esm');
	assert.deepEqual([status, body.error.code, codes(body.error.diagnostics)], [422, 'BUILD_FAILED', ['RUNTIME_NOT_INSTALLED']]);
	assert.match(body.error.diagnostics[0].message, /^"@serving\/absent" is the runtime of "@serving\/orphan@1\.0\.0"; declare it in the application and run beyond install/);
});

test('without a projection the same members are served as before: nothing of the store is reached', async t => {
	const served = await Served.start(t, ['message-v1', 'app-a'], { projected: false });
	const resolution = Resolution.parse(await (await served.get('/resolution.json?target=browser&format=esm')).text());
	assert.deepEqual([...resolution.imports.keys()], ['@serving/app-a/loose', '@serving/app-a/main', '@serving/message/main']);
	assert.equal((await served.json(module('/m/react@18.3.1'))).body.error.code, 'PACKAGE_NOT_FOUND');
});
