/**
 * Integration: the real host of the development service (`service/host/main.mjs`) over an npm workspace with a
 * member outside its root, installed through `POST /installation` against an in-process fixture registry and
 * described through `GET /installation`, `/state`, `/session` and `/selection` (`fixtures/service/README.md`).
 * Run from the Packages directory with the implementation and the watchers utility served (BEE_URL, WATCHERS_URL):
 * `node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/service.test.mjs`. The host is started as its
 * supervisor starts it, in its own process group, with the development extension, and this process attaches as its
 * owner. Everything is removed when the file ends, on failure as well; `BEYOND_HOST_LOG=1` prints the host's log.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeRegistry } from '../cdn-resolution/registry.mjs';
import { Connection } from '../../service/connection.mjs';
import { Host } from '../../service/test/support/host.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/service/', import.meta.url));
const DEVELOPMENT = '@beyond-js/packages/development';

// The runtime the harness gives the host as the toolchain's: the Kernel, a library the graph provides, and one that
// only an adapter of the toolchain needs (installed beside Packages)
const RUNTIME = ['@beyond-js/kernel', 'fixture-text', 'vue'];

/**
 * The temporary disk of the case: the workspace and its external member side by side, the supplied packages,
 * the source store and the metadata cache
 */
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'beyond service install ')));
const root = join(directory, 'workspace');
const widget = join(directory, 'widget');
const store = join(directory, 'store');
const caches = { BEYOND_SOURCES_DIR: store, BEYOND_METADATA_DIR: join(directory, 'metadata') };
const registry = new FakeRegistry({ prefix: '/npm' });
const host = new Host();
let connection;

const publish = async name => {
	const manifest = JSON.parse(readFileSync(join(FIXTURE, 'registry', name, 'package.json'), 'utf8'));
	await registry.publish({ ...manifest, files: { 'index.js': readFileSync(join(FIXTURE, 'registry', name, 'index.js'), 'utf8') } });
};

const state = () => connection.state();
const grouped = packages => Object.groupBy(packages, ({ name }) => name);
const installation = packages => packages.filter(({ source }) => source === 'installation').map(({ name }) => name);
const module = (served, specifier) => served.modules.find(one => one.specifier === specifier);

before(async () => {
	['workspace', 'widget', 'supplied'].forEach(name => cpSync(join(FIXTURE, name), join(directory, name), { recursive: true }));
	await registry.start();
	await publish('fixture-text');
	await publish('fixture-more');
	writeFileSync(join(root, '.npmrc'), `registry=${registry.url}/\n`);

	const supplied = [
		{ name: '@fixture/supplied', path: join(directory, 'supplied/tool'), dependencies: [] },
		{ name: '@fixture/widget', path: join(directory, 'supplied/widget'), dependencies: [] }
	];
	await host.start({ root, supplied, extensions: [DEVELOPMENT], runtime: RUNTIME, env: caches });
	connection = new Connection(host.origin);
});

after(async () => {
	await host.stop();
	process.env.BEYOND_HOST_LOG === '1' && console.log(host.log);
	await registry.stop().catch(() => void 0);
	rmSync(directory, { recursive: true, force: true });
});

test('before installing, the workspace is served from its declaration: members wherever they are, and what is supplied', { timeout: 300000 }, async () => {
	const described = await connection.installation();
	assert.equal(described.state, 'missing');
	assert.equal(described.running, false);
	assert.equal(described.queued, 0);
	assert.equal(described.declaration.kind, 'npm');
	assert.equal(described.declaration.valid, true);
	assert.deepEqual(described.declaration.members, [
		{ id: 'app', name: '@fixture/app', version: '1.0.0' },
		{ id: '../widget', name: '@fixture/widget', version: '1.0.0' }
	]);
	assert.deepEqual(described.lock, { path: join(root, 'beyond-lock.json'), digest: null });
	assert.deepEqual(described.execution, { path: join(root, '.beyond/execution.json'), nodes: 0, written: null });

	const served = await state();
	assert.equal(served.installation.state, 'missing');
	const packages = grouped(served.packages);
	assert.deepEqual(packages['@fixture/app'], [{ name: '@fixture/app', version: '1.0.0', source: 'workspace', node: null, location: join(root, 'app') }]);
	assert.deepEqual(packages['@fixture/widget'], [{ name: '@fixture/widget', version: '1.0.0', source: 'workspace', node: null, location: widget }],
		'the member outside the root is served, and the supplied copy of its name is not');
	assert.equal(packages['@fixture/supplied'][0].source, 'supplied');
	assert.deepEqual(installation(served.packages), ['@beyond-js/kernel', 'fixture-text', 'vue'], 'the runtime the toolchain offers');

	for (const specifier of ['@fixture/app/main', '@fixture/app/extra', '@fixture/widget/view', '@fixture/supplied/tool']) {
		assert.equal(module(served, specifier)?.status, 'valid', `${specifier}: ${JSON.stringify(module(served, specifier))}`);
	}
});

test('a module that builds for browsers only is selected with the address of its preview', { timeout: 120000 }, async () => {
	const { selected, browser, preview, failures } = await connection.selection('@fixture/widget/view', root);
	assert.equal(selected.vspecifier, '@fixture/widget@1.0.0/view');
	assert.equal(browser, true);
	assert.equal(preview, '/preview/?entry=%40fixture%2Fwidget%2Fview');
	assert.deepEqual(failures, []);

	const page = await fetch(`${host.origin}${preview}`);
	assert.equal(page.status, 200, `the development extension serves that address: ${page.status === 200 ? '' : await page.text()}`);
	assert.match(page.headers.get('content-type'), /text\/html/);

	const session = await (await fetch(`${host.origin}/session`)).json();
	assert.deepEqual(session.service.extensions, [DEVELOPMENT]);
	assert.ok(session.runtime.packages.includes('fixture-text'), 'without an installed graph the installation provides the runtime');
});

test('the installation is for the service\'s own clients: no page of another origin reads it or runs one', { timeout: 120000 }, async () => {
	const site = 'https://site.example';
	const read = await fetch(`${host.origin}/installation`, { headers: { origin: site } });
	assert.equal(read.status, 200);
	assert.equal(read.headers.get('access-control-allow-origin'), null);
	const session = await fetch(`${host.origin}/session`, { headers: { origin: site } });
	assert.equal(session.headers.get('access-control-allow-origin'), '*', 'unlike the compiled-module routes');

	const preflight = await fetch(`${host.origin}/installation`, { method: 'OPTIONS', headers: { origin: site, 'access-control-request-method': 'POST' } });
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get('access-control-allow-origin'), null);

	registry.reset();
	const text = await fetch(`${host.origin}/installation`, { method: 'POST', headers: { origin: site, 'content-type': 'text/plain' }, body: '{"update":true}' });
	assert.equal(text.status, 415);
	const foreign = await fetch(`${host.origin}/installation`, { method: 'POST', headers: { origin: site, 'content-type': 'application/json' }, body: '{}' });
	assert.equal(foreign.status, 403);
	assert.equal((await foreign.json()).error.code, 'ORIGIN_REFUSED');
	assert.equal(registry.log.length, 0, 'nothing was installed');
	assert.equal(existsSync(join(root, 'beyond-lock.json')), false);
});

test('a declaration with errors is served with its diagnostics, refused for installation, and recovers', { timeout: 120000 }, async t => {
	const conflict = join(root, 'beyond.json');
	writeFileSync(conflict, JSON.stringify({ packages: ['app'] }));
	t.after(() => rmSync(conflict, { force: true }));
	registry.reset();

	const served = await state();
	assert.ok(served.diagnostics.some(({ code, severity }) => code === 'WORKSPACE_CONFIG_CONFLICT' && severity === 'error'), JSON.stringify(served.diagnostics));
	assert.equal(module(served, '@fixture/app/main'), undefined, 'a declaration in conflict declares no member');

	const failure = await connection.install().then(
		value => assert.fail(`expected a refusal, got ${JSON.stringify(value)}`),
		error => error
	);
	assert.equal(failure.name, 'ContractError');
	assert.equal(failure.code, 'DECLARATION_INVALID');
	assert.equal(failure.status, 422);
	assert.ok(failure.diagnostics.some(({ code }) => code === 'WORKSPACE_CONFIG_CONFLICT'), JSON.stringify(failure.diagnostics));
	assert.equal(registry.log.length, 0, 'no registry was asked');
	assert.equal(existsSync(join(root, 'beyond-lock.json')), false);

	rmSync(conflict);
	const recovered = await state();
	assert.equal(module(recovered, '@fixture/app/main')?.status, 'valid', 'the members are served again once the conflict is removed');
	assert.equal(recovered.diagnostics.some(({ code }) => code === 'WORKSPACE_CONFIG_CONFLICT'), false);
	assert.equal((await connection.installation()).declaration.valid, true);
});

test('installing writes the lock and the projection, and the service then serves the installed graph', { timeout: 600000 }, async () => {
	registry.reset();
	const report = await connection.install();
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.equal(report.lock.written, true);
	assert.equal(report.execution.written, true);
	assert.equal(report.counts.members, 2);
	assert.ok(report.counts.fetched >= 1, JSON.stringify(report.counts));
	assert.ok(registry.log.some(({ path }) => path.includes('fixture-text')));
	assert.equal(registry.log.filter(({ path }) => path.includes('@fixture/')).length, 0, 'the names the workspace provides are never asked for');

	const described = await connection.installation();
	assert.equal(described.state, 'ready', JSON.stringify(described.diagnostics));
	assert.equal(described.lock.digest, report.lock.digest);
	assert.ok(described.execution.nodes >= 3);
	assert.equal(typeof described.execution.written, 'string');

	const served = await state();
	assert.equal(served.installation.state, 'ready');
	const packages = grouped(served.packages);
	assert.equal(packages['@fixture/app'][0].node, 'workspace:app');
	assert.equal(packages['@fixture/widget'][0].node, 'workspace:../widget');
	const [text] = packages['fixture-text'];
	assert.equal(text.source, 'store');
	assert.match(text.node, /:fixture-text@1\.0\.0$/);
	assert.ok(text.location.startsWith(store), `${text.location} is in the source store`);
	assert.equal(served.packages.filter(({ source }) => source === 'supplied').length, 0, 'nothing is supplied with an installed graph');
	assert.equal(module(served, '@fixture/supplied/tool'), undefined);

	assert.equal(module(served, '@fixture/app/main').status, 'valid', JSON.stringify(module(served, '@fixture/app/main')));
	const extra = module(served, '@fixture/app/extra');
	assert.equal(extra.status, 'invalid', 'an import without an edge is not resolved by name any more');
	assert.ok(extra.diagnostics.some(({ code }) => code === 'DEPENDENCY_NOT_INSTALLED'), JSON.stringify(extra));

	const session = await (await fetch(`${host.origin}/session`)).json();
	assert.deepEqual(session.runtime.packages, ['@beyond-js/kernel'], 'neither what the graph provides nor what only an adapter needed (A13)');
	assert.deepEqual(installation(served.packages), ['@beyond-js/kernel']);
});

test('a dependency added to a member outside the root makes the installation stale, and installing again recovers', { timeout: 600000 }, async () => {
	const manifest = JSON.parse(readFileSync(join(widget, 'package.json'), 'utf8'));
	writeFileSync(join(widget, 'package.json'), JSON.stringify({ ...manifest, dependencies: { 'fixture-more': '^1.0.0' } }, null, '\t'));

	const described = await connection.installation();
	assert.equal(described.state, 'stale');
	const [stale] = described.diagnostics.filter(({ code }) => code === 'EXECUTION_GRAPH_STALE');
	assert.ok(stale?.details?.changed?.includes('member:../widget'), JSON.stringify(described.diagnostics));

	const served = await state();
	assert.equal(served.installation.state, 'stale', 'the host saw the manifest outside its root and reloaded');
	assert.equal(served.packages.filter(({ source }) => source === 'supplied').length, 0, 'a stale graph is still the graph: nothing is supplied');
	assert.deepEqual(installation(served.packages), ['@beyond-js/kernel'], 'nor anything only an adapter needed');

	const report = await connection.install();
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.equal((await connection.installation()).state, 'ready');
	const recovered = await state();
	assert.equal(recovered.installation.state, 'ready');
	assert.equal(grouped(recovered.packages)['fixture-more']?.[0]?.source, 'store');
});

test('a member pointed to another directory with the same manifest is not served as installed, and installing again recovers', { timeout: 600000 }, async () => {
	// The link the member is reached through now leads to another checkout of the same release
	renameSync(widget, `${widget}-a`);
	cpSync(`${widget}-a`, `${widget}-b`, { recursive: true });
	symlinkSync(`${widget}-b`, widget);

	// The projection locates the member elsewhere than declared: incompatible (A20, A25), never ready
	const described = await connection.installation();
	assert.equal(described.state, 'incompatible', JSON.stringify(described.diagnostics));
	const moved = described.diagnostics.find(({ code }) => code === 'EXECUTION_GRAPH_INCOMPATIBLE');
	assert.ok(moved?.details?.changed?.includes('member:../widget'), JSON.stringify(described.diagnostics));
	assert.equal((await state()).installation.state, 'incompatible', 'the host saw the member move and reloaded');

	registry.reset();
	const report = await connection.install();
	assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
	assert.equal(report.frozen, true, 'the lock still holds: only the location changed');
	assert.equal(registry.log.length, 0);
	const served = await state();
	assert.equal(served.installation.state, 'ready');
	assert.equal(grouped(served.packages)['@fixture/widget'][0].location, realpathSync(`${widget}-b`));
});

test('a declaration with errors does not stop the service: it serves what was declared, says why, and refuses to install', { timeout: 300000 }, async t => {
	// A workspace of its own, with its own host: two directories of one release (`fixtures/service/duplicated`)
	const duplicated = join(directory, 'duplicated');
	cpSync(join(FIXTURE, 'duplicated'), duplicated, { recursive: true });
	const own = new Host();
	t.after(() => own.stop());
	await own.start({ root: duplicated, extensions: [DEVELOPMENT], runtime: RUNTIME, env: caches });
	const served = new Connection(own.origin);

	const { diagnostics } = await served.state();
	const instance = diagnostics.find(({ code }) => code === 'WORKSPACE_INSTANCE_DUPLICATED');
	assert.equal(instance?.severity, 'error', JSON.stringify(diagnostics));
	assert.deepEqual(instance.paths, ['one', 'two'], 'named relative to the root');
	assert.ok(diagnostics.some(({ code }) => code === 'PACKAGE_DUPLICATED'), 'Packages still reports the workspace it was given');

	await assert.rejects(served.selection('@fixture/twice/main', duplicated), {
		code: 'PACKAGE_DUPLICATED',
		message: /declared by more than one workspace package: one, two/
	});

	const described = await served.installation();
	assert.equal(described.declaration.valid, false);
	assert.ok(described.declaration.diagnostics.some(({ code }) => code === 'WORKSPACE_INSTANCE_DUPLICATED'));
	await assert.rejects(served.install(), { code: 'DECLARATION_INVALID', status: 422 });
});
