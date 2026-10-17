import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Operations } from '../host/operations/operations.mjs';
import { Members } from '../host/production/members.mjs';
import { WebExport } from '../host/production/web/export.mjs';
import { Records } from '../host/production/web/records.mjs';
import { Staging } from '../host/production/web/staging.mjs';
import { copy, until } from '../../tests/production/support/workspaces.mjs';
import { delivery as stand, description } from '../../tests/production/support/page.mjs';

/**
 * The services the development extension shares: a catalog that resolves `site/web` to the page's entry
 */
const catalog = (resolve = async (application, target) => {
	if (application !== 'site') throw Object.assign(new Error(`There is no application "${application}"`), { code: 'APPLICATION_NOT_FOUND' });
	if (target === 'api') return { application: { id: 'site' }, declared: { id: 'api', kind: 'backend' }, entry: { specifier: '@site/api/server' }, diagnostics: [] };
	if (target === 'broken') {
		const diagnostics = [{ code: 'TARGET_ENTRY_NOT_FOUND', severity: 'error', message: '"@site/web" publishes no public module "./broken"' }];
		return { application: { id: 'site' }, declared: { id: 'broken', kind: 'frontend' }, entry: { specifier: '@site/web/broken' }, diagnostics };
	}
	if (target !== 'web') throw Object.assign(new Error(`There is no target "${target}"`), { code: 'TARGET_NOT_FOUND' });
	const entry = { specifier: '@site/web/main', vspecifier: '@site/web@1.0.0/main' };
	return { application: { id: 'site', title: 'Site' }, declared: { id: 'web', kind: 'frontend', title: 'Web page' }, entry, environment: 'browser', diagnostics: [] };
}) => ({ get: name => (name === 'applications' ? { resolve } : name === 'files' ? {} : void 0) });

/**
 * A web export over a copy of the packages fixture, with the page's description and delivery stand-ins
 */
const setup = async (t, { page = stand(), services = catalog(), describe, origin } = {}) => {
	const { root, settle } = copy(t, 'packages');
	const operations = new Operations({ root });
	await operations.start();
	settle(() => operations.idle());
	const records = new Records(root);
	const described = [];
	const exporter = new WebExport(root, {
		delivery: page,
		services,
		describe: describe ?? (async (entry, strategy, cdn) => (described.push({ entry, strategy, cdn }), description())),
		members: () => new Members(root).declared.map(({ path }) => path),
		records,
		origin: () => origin,
		toolchain: { packages: '0.0.1', node: process.versions.node }
	});
	const run = async (body, key = `export-${Math.random().toString(16).slice(2, 14)}`) => {
		const request = exporter.request(body);
		const { operation } = await operations.run({ kind: 'production.export', key, cancellable: true, steps: WebExport.STEPS }, op => exporter.run(op, request));
		await until(async () => (await operations.get(operation.id)).state !== 'running');
		return operations.get(operation.id);
	};
	return { root, run, records, page, described, exporter, operations };
};

const BODY = { application: 'site', target: 'web', strategy: 'self-contained', destination: 'dist/web' };

test('a self-contained export writes the page, every module it loads, its stylesheets and assets, and its manifest', async t => {
	const { root, run, records, page, described } = await setup(t);
	const ended = await run({ ...BODY, base: '/app' });
	assert.equal(ended.state, 'succeeded', JSON.stringify(ended.error));
	assert.deepEqual(described.map(({ strategy }) => strategy), ['self-contained']);
	assert.ok(page.asked.every(({ conditions }) => conditions.platform === 'web' && conditions.environment === 'production'), 'only production output is asked for');

	const directory = join(root, 'dist', 'web');
	const file = path => readFileSync(join(directory, path), 'utf8');
	const files = ['index.html', 'beyond-export.json', 'm/@site/web@1.0.0/modules/main.js', 'm/@site/web@1.0.0/modules/lazy.js', 'm/@site/web@1.0.0/styles/main.css',
		'm/@site/web@1.0.0/assets/main/logo.svg', 'm/@site/web@1.0.0/assets/main/bg.png', 'm/@site/other@1.0.0/modules/widget.js', 'm/runtime@1.0.0/modules/bundle.js', 'm/lib@1.0.0/modules/~root.js', 'm/lib@2.0.0/modules/~root.js'];
	files.forEach(path => assert.ok(existsSync(join(directory, path)), path));
	assert.ok(!existsSync(join(directory, 'm/runtime@1.0.0/modules/main.js')), 'the development coordinator never enters the export');
	assert.equal(file('m/@site/web@1.0.0/modules/main.js').includes('sourceMappingURL'), false, 'production output, without a map');

	const html = file('index.html');
	const map = JSON.parse(/<script type="importmap">\n([\s\S]*?)\n<\/script>/.exec(html)[1]);
	assert.equal(map.imports['@site/web/main'], '/app/m/@site/web@1.0.0/modules/main.js');
	assert.equal(map.imports['@site/web/main.css'], '/app/m/@site/web@1.0.0/styles/main.css');
	assert.equal(map.imports['runtime/main'], undefined);
	assert.deepEqual(map.scopes, { '/app/m/@site/other@1.0.0/': { lib: '/app/m/lib@2.0.0/modules/~root.js' } });
	assert.match(html, /<link rel="stylesheet" data-beyond-styles="@site\/web@1.0.0\/main" href="\/app\/m\/@site\/web@1.0.0\/styles\/main.css">/);
	assert.match(html, /import "@site\/web\/main";/);
	assert.match(html, /<title>Web page<\/title>/, 'the target\'s title');
	assert.ok(!/register|EventSource|\.\.\/|127\.0\.0\.1/.test(html), 'no development runtime, relative preview address or origin');

	const manifest = JSON.parse(file('beyond-export.json'));
	assert.equal(manifest.protocol, 'beyond-web-export/1');
	assert.match(manifest.id, /^exp_[0-9a-f]{24}$/);
	assert.deepEqual([manifest.application, manifest.target, manifest.strategy, manifest.base], ['site', 'web', 'self-contained', '/app/']);
	assert.deepEqual(manifest.entry, { specifier: '@site/web/main', vspecifier: '@site/web@1.0.0/main', source: 'catalog' });
	const main = manifest.files.find(({ path }) => path === 'm/@site/web@1.0.0/modules/main.js');
	assert.equal(main.digest, `sha256-${createHash('sha256').update(readFileSync(join(directory, main.path))).digest('base64')}`);
	assert.deepEqual(manifest.sources.find(({ name }) => name === '@site/web'), { name: '@site/web', version: '1.0.0', provider: 'workspace' });
	assert.ok(!JSON.stringify(manifest).includes('/private/path'), 'no path of this machine');
	assert.deepEqual(manifest.installation, { state: 'missing' });
	assert.equal(ended.result.export.files, manifest.files.length);
	assert.deepEqual((await records.list()).map(({ id, destination }) => [id, destination]), [[manifest.id, 'dist/web']]);
	assert.deepEqual(readdirSync(join(root, '.beyond', 'production', 'staging')), [], 'nothing is left staged');
});

test('a destination that is not a directory of the workspace\'s own is refused before anything is read', async t => {
	const { root, exporter, run } = await setup(t);
	for (const destination of ['/tmp/web', '../web', 'dist/../web', 'dist//web', '.beyond/web', 'dist/node_modules/web', 'packages/ui', 'packages/ui/web', 'packages', '', 42]) {
		assert.throws(() => exporter.request({ ...BODY, destination }), { code: 'EXPORT_DESTINATION_INVALID' }, String(destination));
	}
	assert.throws(() => exporter.request({ ...BODY, strategy: 'bundle' }), { code: 'REQUEST_INVALID' });
	assert.throws(() => exporter.request({ ...BODY, base: 'app' }), { code: 'REQUEST_INVALID' });
	assert.throws(() => exporter.request({ ...BODY, base: '/a/../b/' }), { code: 'REQUEST_INVALID' });
	assert.throws(() => exporter.request({ ...BODY, replace: 'everything' }), { code: 'REQUEST_INVALID' });
	assert.throws(() => exporter.request({ ...BODY, application: 'Site' }), { code: 'REQUEST_INVALID' });

	// A link is found when the destination is checked, before anything is written through it
	mkdirSync(join(root, 'elsewhere'));
	symlinkSync(join(root, 'elsewhere'), join(root, 'linked'));
	const linked = await run({ ...BODY, destination: 'linked/web' });
	assert.deepEqual([linked.state, linked.error.code], ['failed', 'EXPORT_DESTINATION_INVALID']);
	assert.deepEqual(readdirSync(join(root, 'elsewhere')), []);
});

test('a destination that holds other files, or an earlier export not named in "replace", is a conflict', async t => {
	const { root, run } = await setup(t);
	mkdirSync(join(root, 'dist', 'web'), { recursive: true });
	writeFileSync(join(root, 'dist', 'web', 'notes.txt'), 'mine\n');
	const foreign = await run(BODY);
	assert.deepEqual([foreign.state, foreign.error.code], ['failed', 'EXPORT_DESTINATION_CONFLICT']);
	assert.equal(readFileSync(join(root, 'dist', 'web', 'notes.txt'), 'utf8'), 'mine\n', 'nothing is written over them');

	const first = await run({ ...BODY, destination: 'dist/site' });
	const again = await run({ ...BODY, destination: 'dist/site' });
	assert.deepEqual([again.state, again.error.code, again.error.details.replace], ['failed', 'EXPORT_DESTINATION_CONFLICT', first.result.export.id]);
	const replaced = await run({ ...BODY, destination: 'dist/site', replace: first.result.export.id });
	assert.equal(replaced.state, 'succeeded', JSON.stringify(replaced.error));
	assert.notEqual(replaced.result.export.id, first.result.export.id);
	assert.equal(JSON.parse(readFileSync(join(root, 'dist', 'site', 'beyond-export.json'), 'utf8')).id, replaced.result.export.id);

	const other = await run({ ...BODY, target: 'web', application: 'site', destination: 'dist/site', replace: 'exp_000000000000000000000000' });
	assert.equal(other.error.code, 'EXPORT_DESTINATION_CONFLICT', 'a replace that names another export');
});

test('a module without production output, an import without an address and a secret asset fail the export, leaving the destination', async t => {
	const unbuilt = await setup(t, { page: stand({ production: false }) });
	const development = await unbuilt.run(BODY);
	assert.deepEqual([development.state, development.error.code], ['failed', 'EXPORT_PRODUCTION_UNAVAILABLE']);
	assert.ok(!existsSync(join(unbuilt.root, 'dist', 'web')), 'nothing is written');

	const broken = await setup(t, { page: stand({ override: { '@site/web@1.0.0/lazy': { failure: { code: 'BUILD_FAILED', message: 'does not build', diagnostics: [{ code: 'TS2304', message: 'Cannot find name "x"' }] } } } }) });
	const failed = await broken.run(BODY);
	assert.equal(failed.error.code, 'EXPORT_GRAPH_INCOMPLETE');
	assert.deepEqual(failed.error.details.diagnostics.map(({ code }) => code), ['TS2304']);

	const missing = description();
	delete missing.importmap.imports.lib;
	missing.modules.find(({ specifier }) => specifier === 'lib').source = 'unresolved';
	missing.modules.find(({ specifier }) => specifier === 'lib').reason = 'No version of "lib" is installed';
	const unresolved = await (await setup(t, { describe: async () => missing })).run(BODY);
	assert.equal(unresolved.error.code, 'EXPORT_GRAPH_INCOMPLETE');
	assert.match(unresolved.error.details.diagnostics[0].message, /"lib", imported by \/m\/@site\/web@1\.0\.0\/modules\/main: No version of "lib" is installed/);

	const secret = await setup(t, { page: stand({ override: { '@site/web@1.0.0/lazy': { dependencies: [], code: 'new URL("../assets/lazy/.env", import.meta.url)' } } }) });
	const refused = await secret.run(BODY);
	assert.deepEqual(refused.error.details.diagnostics.map(({ code }) => code), ['EXPORT_SECRET_REFUSED']);
});

test('the cdn strategy references what the CDN holds with its integrity, and is refused where it cannot be honoured', async t => {
	const cdn = 'https://cdn.example';
	const remote = description();
	const url = `${cdn}/m/lib@1.0.0/modules/~root?target=browser&format=esm`;
	remote.importmap.imports.lib = url;
	remote.importmap.integrity = { [url]: 'sha256-cdn' };
	remote.modules.find(({ specifier }) => specifier === 'lib').source = 'cdn';
	const self = await (await setup(t, { describe: async () => remote })).run(BODY);
	assert.deepEqual(self.error.details.diagnostics.map(({ code }) => code), ['EXPORT_REMOTE_REFUSED'], 'a self-contained export references nothing outside');

	const { root, run, described } = await setup(t, { describe: async (entry, strategy, origin) => (described.push({ strategy, origin }), remote), origin: cdn });
	const ended = await run({ ...BODY, strategy: 'cdn' });
	assert.equal(ended.state, 'succeeded', JSON.stringify(ended.error));
	assert.deepEqual(described, [{ strategy: 'cdn', origin: cdn }]);
	const html = readFileSync(join(root, 'dist', 'web', 'index.html'), 'utf8');
	const map = JSON.parse(/<script type="importmap">\n([\s\S]*?)\n<\/script>/.exec(html)[1]);
	assert.equal(map.imports.lib, url);
	assert.deepEqual(map.integrity, { [url]: 'sha256-cdn' });
	assert.ok(!existsSync(join(root, 'dist', 'web', 'm', 'lib@1.0.0')), 'what the CDN holds is not written');
	assert.deepEqual(ended.result.manifest.cdn, { origin: cdn, modules: [{ specifier: 'lib', url, integrity: 'sha256-cdn' }] });

	const unset = await (await setup(t)).run({ ...BODY, strategy: 'cdn' });
	assert.equal(unset.error.code, 'EXPORT_STRATEGY_UNSUPPORTED', 'without a CDN origin');
	const installed = stand();
	installed.execution = {};
	const graph = await (await setup(t, { page: installed, origin: cdn })).run({ ...BODY, strategy: 'cdn' });
	assert.equal(graph.error.code, 'EXPORT_STRATEGY_UNSUPPORTED', 'an installed workspace serves every node itself');
});

test('the target is resolved by the catalog: unknown, backend and absent catalogs are told apart', async t => {
	const { run } = await setup(t);
	assert.equal((await run({ ...BODY, application: 'shop' })).error.code, 'APPLICATION_NOT_FOUND');
	assert.equal((await run({ ...BODY, target: 'admin' })).error.code, 'TARGET_NOT_FOUND');
	assert.equal((await run({ ...BODY, target: 'api' })).error.code, 'TARGET_NOT_FRONTEND');
	const broken = await run({ ...BODY, target: 'broken' });
	assert.deepEqual([broken.error.code, broken.error.details.diagnostics[0].code], ['TARGET_UNRESOLVED', 'TARGET_ENTRY_NOT_FOUND']);

	const absent = await setup(t, { services: { get: () => void 0 } });
	assert.equal((await absent.run(BODY)).error.code, 'APPLICATIONS_UNAVAILABLE');
	const requested = await absent.run({ ...BODY, entry: '@site/web/main' });
	assert.equal(requested.state, 'succeeded', JSON.stringify(requested.error));
	assert.equal(requested.result.manifest.entry.source, 'request');
	assert.deepEqual(requested.result.manifest.diagnostics.map(({ code }) => code), ['EXPORT_ENTRY_FROM_REQUEST'], 'an entry the request named is said');
});

test('a cancelled export stops between two outputs and leaves nothing behind', async t => {
	let release;
	const held = new Promise(resolve => (release = resolve));
	const page = stand();
	const module = page.module.bind(page);
	page.module = async (...args) => (await held, module(...args));
	const { root, exporter, operations } = await setup(t, { page });
	const request = exporter.request(BODY);
	const { operation } = await operations.run({ kind: 'production.export', key: 'export-cancel-0001', cancellable: true, steps: WebExport.STEPS }, op => exporter.run(op, request));
	await until(async () => (await operations.get(operation.id)).steps[2].state === 'progress');
	await operations.cancel(operation.id);
	release();
	await until(async () => (await operations.get(operation.id)).state !== 'running');
	assert.equal((await operations.get(operation.id)).state, 'cancelled');
	assert.ok(!existsSync(join(root, 'dist', 'web')));
});

test('an export interrupted between its moves is put right when the service starts again', async t => {
	const { root } = copy(t, 'packages');
	const records = new Records(root);
	const write = (path, content) => (mkdirSync(join(root, path, '..'), { recursive: true }), writeFileSync(join(root, path), content));
	const staging = path => join('.beyond', 'production', 'staging', path);

	// Stopped after the earlier export moved aside and before the new one took its place: the earlier one goes back
	const earlier = 'exp_000000000000000000000001';
	write(staging(`${earlier}.json`), JSON.stringify({ id: earlier, destination: 'dist/web' }));
	write(staging(`${earlier}.previous/index.html`), 'earlier export');
	write(staging(`${earlier}/index.html`), 'new export, never moved');

	// Stopped after the new export took its place and before it was recorded: it stays, and is recorded
	const later = 'exp_000000000000000000000002';
	write(staging(`${later}.json`), JSON.stringify({ id: later, destination: 'dist/site' }));
	write(staging(`${later}.previous/index.html`), 'replaced export');
	write('dist/site/index.html', 'new export, in place');
	write('dist/site/beyond-export.json', JSON.stringify({ protocol: 'beyond-web-export/1', id: later, application: 'site', target: 'web', created: '2026-10-11T12:00:00.000Z' }));

	await Staging.recover(root, records);
	assert.equal(readFileSync(join(root, 'dist', 'web', 'index.html'), 'utf8'), 'earlier export');
	assert.equal(readFileSync(join(root, 'dist', 'site', 'index.html'), 'utf8'), 'new export, in place');
	assert.deepEqual((await records.get(later)).destination, 'dist/site');
	assert.ok(!existsSync(join(root, '.beyond', 'production', 'staging')), 'nothing staged is left');
});

test('without a destination the export goes to the service own folder, replaces its earlier one there, and its last count reaches its total', async t => {
	const { root, run } = await setup(t);
	const { destination, application, target } = { ...BODY, destination: undefined };
	const first = await run({ application, target, strategy: 'self-contained', destination });
	assert.equal(first.state, 'succeeded', JSON.stringify(first.error));
	assert.equal(first.result.export.destination, '.beyond/production/exports/site/web');
	assert.ok(existsSync(join(root, '.beyond', 'production', 'exports', 'site', 'web', 'index.html')));
	assert.equal(existsSync(join(root, 'dist')), false, 'nothing beside the sources');
	const write = first.steps.find(step => step.id === 'write');
	assert.equal(write.counts.done, write.counts.total, 'the last phase reaches its total');

	const second = await run({ application, target, strategy: 'self-contained' });
	assert.equal(second.state, 'succeeded', 'the earlier export there is replaced without being named');
	const manifest = JSON.parse(readFileSync(join(root, '.beyond', 'production', 'exports', 'site', 'web', 'beyond-export.json'), 'utf8'));
	assert.equal(manifest.id, second.result.export.id);
});

test('an export made without an installed graph says it is for trying the page only, and records its plan', async t => {
	const { root, run } = await setup(t);
	const ended = await run(BODY);
	const { export: answer } = ended.result;
	assert.deepEqual([answer.plan, answer.developmentOnly], ['development', true]);
	assert.match(answer.reason, /not what beyond build produces/);
	assert.doesNotMatch(answer.reason, /BEYOND_/);
	assert.equal(JSON.parse(readFileSync(join(root, 'dist', 'web', 'beyond-export.json'), 'utf8')).plan, 'development');

	const installed = await setup(t, { page: Object.assign(stand(), { execution: { nodes: new Map() } }) });
	const built = (await installed.run(BODY)).result.export;
	assert.deepEqual([built.plan, built.developmentOnly], ['installed', undefined]);
});
