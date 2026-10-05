/**
 * How the routes that hand an installed graph to a browser walk it (`fixtures/serving`, read its README; the harness is
 * `support/serving.mjs`): a package importing another subpath of itself, a member's peer bound by the instances that
 * reached it, the coordinator of the page's runtime, store nodes that do not build or whose sources are missing, a
 * Git node, stylesheets selected by specifier, a lattice of shared packages, and the candidates of a preview.
 *
 * It needs `BEE_URL` and the loader of `BEE_NODE_DIR` (see `tests/stage-1/README.md`); no watcher is needed:
 *
 * ```sh
 * BEE_URL=http://localhost:1112,… node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/serving.walk.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Resolution } from '@beyond-js/artifact-api';
import { QUERY, Served, codes, module, table } from './support/serving.mjs';

const CDN = 'BEYOND_CDN_ORIGIN';
const configured = process.env[CDN];
delete process.env[CDN];
after(() => (configured === void 0 ? delete process.env[CDN] : (process.env[CDN] = configured)));

const versions = (page, specifier) => page.body.modules.filter(one => one.specifier === specifier).map(({ version }) => version);
const failing = (page, scope, specifier) => decodeURIComponent(page.body.importmap.scopes?.[scope]?.[specifier] ?? '');
/**
 * The resolution of the workspace, refused with diagnostics of the expected codes
 */
const refused = async (served, expected) => {
	const { status, body } = await served.json('/resolution.json?target=browser&format=esm');
	assert.deepEqual([status, body.error?.code, codes(body.error?.diagnostics).sort()], [422, 'BUILD_FAILED', expected]);
	return body.error.diagnostics;
};

test('self: a store package that imports another subpath of itself is walked on, not taken for a cycle', async t => {
	const served = await Served.start(t, ['app-s']);
	const page = await served.preview('@serving/app-s/main');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	assert.deepEqual(page.body.diagnostics, []);
	assert.deepEqual(page.body.importmap.imports, {
		'@serving/app-s/main': `..${module('/m/@serving/app-s@1.0.0', 'main')}`,
		selfy: `..${module('/m/selfy@1.0.0')}`,
		'selfy/extra': `..${module('/m/selfy@1.0.0', 'extra')}`,
		deppy: `..${module('/m/deppy@1.0.0')}`
	});
	const resolution = Resolution.parse(await (await served.get('/resolution.json?target=browser&format=esm')).text());
	assert.equal(resolution.resolve('deppy', '/m/selfy@1.0.0/modules/extra'), module('/m/deppy@1.0.0'));
});

test('peers: a member developed on its own binds its peer to 2.0.0, and to the 1.0.0 of the application that reaches it', async t => {
	const served = await Served.start(t, ['message-v1', '../outside/message-v2', 'peer-lib', 'app-m1']);
	const page = await served.preview('@serving/app-m1/main');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	assert.deepEqual(versions(page, '@serving/message/main'), ['1.0.0'], 'one version of the peer in the page');
	assert.equal(page.body.importmap.scopes, undefined, 'the library needs no version of its own');

	const own = await served.preview('@serving/peer-lib/main');
	assert.deepEqual(versions(own, '@serving/message/main'), ['2.0.0']);
	const [diagnostic] = await refused(served, ['PEER_CONTEXT_AMBIGUOUS']);
	assert.match(diagnostic.message, /"@serving\/peer-lib@1\.0\.0" imports "@serving\/message\/main" as \/m\/@serving\/message@2\.0\.0\/modules\/main/);
});

test('runtime: the coordinator of the page is the one of its runtime instance, whatever order declares the versions', async t => {
	for (const ids of [['runtime-v2', 'runtime', 'lib', 'app-c'], ['runtime', 'runtime-v2', 'lib', 'app-c']]) {
		const served = await Served.start(t, ids);
		const page = await served.preview('@serving/app-c/main');
		assert.equal(page.status, 200, JSON.stringify(page.body));
		assert.equal(page.body.updates.runtime, '@serving/runtime/main', ids.join());
		assert.equal(page.body.importmap.imports['@serving/runtime/main'], `..${module('/m/@serving/runtime@1.0.0', 'main')}`, ids.join());
		assert.ok(!JSON.stringify(page.body.importmap).includes('@serving/runtime@2.0.0'), `${ids.join()}: one runtime in the page`);
	}
});

test('failures: a store node that does not build, or whose sources are missing, is reported and never served', async t => {
	const served = await Served.start(t, ['app-w']);
	const page = await served.preview('@serving/app-w/main');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	for (const [specifier, code] of [['broken', 'BUILD_FAILED'], ['gone', 'SOURCE_MISSING']]) {
		const record = page.body.modules.find(one => one.specifier === specifier);
		assert.deepEqual([record.source, record.url, record.vspecifier], ['unresolved', void 0, void 0], specifier);
		assert.match(failing(page, '../m/@serving/app-w@1.0.0/', specifier), new RegExp(`^data:text/javascript,throw new Error\\("\\[beyond preview\\] ${code}: `));
		assert.equal(page.body.importmap.imports[specifier], void 0, `${specifier} is not served`);
	}
	assert.deepEqual(codes(page.body.diagnostics).sort(), ['BUILD_FAILED', 'SOURCE_MISSING']);
	assert.match(page.body.modules.find(one => one.specifier === 'gone').reason, /run beyond install/);
	await refused(served, ['BUILD_FAILED', 'SOURCE_MISSING']);
});

test('sources: an import of a Git node fails in its importer with why, and no document leaves it out', async t => {
	const served = await Served.start(t, ['app-g']);
	const page = await served.preview('@serving/app-g/main');
	const tool = page.body.modules.find(one => one.specifier === 'tool');
	assert.deepEqual([tool.source, tool.version], ['unresolved', '1.0.0']);
	assert.deepEqual(codes(page.body.diagnostics), ['PREVIEW_SOURCE_UNSUPPORTED']);
	assert.match(failing(page, '../m/@serving/app-g@1.0.0/', 'tool'), /PREVIEW_SOURCE_UNSUPPORTED: \\"tool\\" has no address: \\"tool@1\.0\.0\\" was installed from Git/);
	await refused(served, ['SOURCE_UNSUPPORTED']);
});

test('stylesheets: a stylesheet selected by specifier is the one its importer\'s edges reach, and nothing else', async t => {
	const url = `../m/kit-css@1.0.0/styles/theme.css?${QUERY}`;
	const served = await Served.start(t, ['app-t']);
	const page = await served.preview('@serving/app-t/main');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	assert.deepEqual(page.body.modules.find(one => one.specifier === '@serving/app-t/main').stylesheets, [{ specifier: 'kit-css/theme.css', vspecifier: 'kit-css@1.0.0/theme.css', url }]);
	const sheet = await served.get(new URL(url, new URL('/preview/', served.origin)));
	assert.deepEqual([sheet.status, (await sheet.text()).includes('teal')], [200, true]);
	const resolution = Resolution.parse(await (await served.get('/resolution.json?target=browser&format=esm')).text());
	assert.equal(resolution.resolve('kit-css/theme.css', '/m/@serving/app-t@1.0.0/modules/main'), url.slice(2));

	// A member the installed graph does not know selects nothing: not from the disk, the toolchain or the CDN
	process.env[CDN] = 'https://cdn.example.test';
	t.after(() => delete process.env[CDN]);
	const unlisted = await Served.start(t, ['app-t'], { unlisted: ['app-t'] });
	const stale = await unlisted.preview('@serving/app-t/main');
	assert.deepEqual(codes(stale.body.diagnostics), ['DEPENDENCY_NOT_INSTALLED']);
	assert.equal(stale.body.modules.find(one => one.specifier === '@serving/app-t/main').stylesheets, void 0);
	assert.ok(!JSON.stringify(stale.body.importmap).includes('cdn.example.test'), 'nothing is asked of the CDN');
});

test('walk: an instance is walked once per context that can change what it binds, not once per path', async t => {
	const layers = 10;
	const served = await Served.start(t, ['app-l'], { lattice: layers });
	const first = await served.preview('@serving/app-l/main');
	assert.equal(first.status, 200, JSON.stringify(first.body));
	assert.equal(Object.keys(first.body.importmap.imports).length, 2 * layers + 1, 'every package of the lattice, once');

	// 2^10 paths reach the bottom of the lattice; a walk follows each package once: the application's module and one
	// module of each package are asked of the delivery, never one per path
	served.count();
	assert.equal((await served.preview('@serving/app-l/main')).status, 200);
	assert.equal(served.count(), 2 * layers + 1, 'the preview asks for each module once');
	const resolution = Resolution.parse(await (await served.get('/resolution.json?target=browser&format=esm')).text());
	assert.equal(table(resolution.imports).d9b, module('/m/d9b@1.0.0'));
	assert.equal(served.count(), 2 * layers + 1, 'and so does the resolution');
});

test('candidates: versions that share a specifier are offered by version', async t => {
	const served = await Served.start(t, ['message-v1', '../outside/message-v2']);
	const { status, body } = await served.json('/preview/entry.json');
	assert.deepEqual([status, body.error.code], [409, 'PREVIEW_ENTRY_REQUIRED']);
	assert.deepEqual(body.error.candidates, ['@serving/message@1.0.0/main', '@serving/message@2.0.0/main']);
});
