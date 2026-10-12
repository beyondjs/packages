import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Browser } from './support/browser.mjs';
import { Served } from './support/served.mjs';
import { CdnStand, StaticHost } from './support/static.mjs';

/**
 * The web export of a declared frontend target, from the real development service started from this checkout, served
 * by an independent static host and loaded in a headless Chromium once the service has stopped. See README.md.
 */
const parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond production export ')));
const served = new Served(parent);
const cdn = new CdnStand();
const hosts = [];
let browser;
let stopped = false;
let tiny;
const KEY = () => `export-${createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 16)}`;
const TINY = '/m/tiny@1.0.0/modules/~root';
const LAZY = '/m/@production/web@1.0.0/modules/lazy';

const files = directory => readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => relative(directory, join(entry.parentPath, entry.name)).split('\\').join('/')).sort();
const exported = async body => {
	const started = await served.send('POST', '/production/exports', { headers: { 'idempotency-key': KEY() }, body });
	assert.equal(started.status, 202, JSON.stringify(started.body));
	return served.follow(started.headers.location);
};

before(async () => {
	await cdn.start();
	await served.start({ environment: { BEYOND_CDN_ORIGIN: cdn.origin } });
	// What CDN delivery would hold of the installed package: its production output, as this environment compiles it
	const answer = await served.send('GET', `${TINY}?target=browser&format=esm&env=production&min=true&sourcemap=none`);
	assert.equal(answer.status, 200, JSON.stringify(answer.body));
	tiny = answer.body;
	cdn.serve(TINY, tiny);
}, { timeout: 900000 });

after(async () => {
	await browser?.stop();
	hosts.forEach(host => host.stop());
	cdn.stop();
	!stopped && (await served.stop().catch(() => void 0));
	rmSync(parent, { recursive: true, force: true });
}, { timeout: 120000 });

test('the service claims production, and the catalog resolves the declared target', async () => {
	assert.equal(served.session.capabilities.production, 1);
	const resolved = await served.send('GET', '/applications/site/targets/web');
	assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
	assert.equal(resolved.body.entry.specifier, '@production/web/main');
});

test('a self-contained export holds the page, every output it loads, eagerly or lazily, and nothing secret', { timeout: 600000 }, async () => {
	const operation = await exported({ application: 'site', target: 'web', strategy: 'self-contained', destination: 'dist/web' });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation.error));
	assert.deepEqual(operation.steps.map(({ id, state }) => `${id}:${state}`), ['target:done', 'graph:done', 'outputs:done', 'write:done']);

	const directory = join(served.root, 'dist', 'web');
	const written = files(directory);
	const expected = ['beyond-export.json', 'index.html', 'm/@beyond-js/local-2026@0.1.0/modules/bundle.js', 'm/@production/art@1.0.0/assets/badge/logo.svg', 'm/@production/art@1.0.0/modules/badge.js',
		'm/@production/art@1.0.0/styles/badge.css', 'm/@production/shared@1.0.0/modules/text.js', 'm/@production/web@1.0.0/modules/lazy.js', 'm/@production/web@1.0.0/modules/main.js', 'm/@production/web@1.0.0/styles/main.css', 'm/tiny@1.0.0/modules/~root.js'];
	assert.deepEqual(written, expected);

	const manifest = JSON.parse(readFileSync(join(directory, 'beyond-export.json'), 'utf8'));
	assert.deepEqual([manifest.protocol, manifest.application, manifest.target, manifest.strategy, manifest.base], ['beyond-web-export/1', 'site', 'web', 'self-contained', '/']);
	assert.deepEqual(manifest.entry, { specifier: '@production/web/main', vspecifier: '@production/web@1.0.0/main', source: 'catalog' });
	for (const file of manifest.files) assert.equal(file.digest, `sha256-${createHash('sha256').update(readFileSync(join(directory, file.path))).digest('base64')}`, file.path);
	assert.deepEqual(manifest.sources.map(({ name, provider }) => `${name}:${provider}`), ['@beyond-js/local-2026:workspace', '@production/art:workspace', '@production/shared:workspace', '@production/web:workspace', 'tiny:installed']);

	const everything = written.map(path => readFileSync(join(directory, path), 'utf8')).join('\n');
	assert.ok(!everything.includes('PRODUCTION_SECRET'), 'the .env beside the sources is in no file');
	assert.ok(!everything.includes(served.root) && !everything.includes(parent), 'no path of this machine');
	assert.ok(!everything.includes(served.origin), 'no address of the development service');
	assert.ok(!/sourceMappingURL=data:|\/u\/|EventSource|beyond-dev-/.test(everything), 'no development map, update route or development protocol');
	assert.equal((await served.send('GET', '/production/exports')).body.exports[0].id, manifest.id);
});

test('the cdn strategy writes the workspace\'s modules and pins the installed package it references on the CDN', { timeout: 600000 }, async () => {
	const operation = await exported({ application: 'site', target: 'web', strategy: 'cdn', destination: 'dist/cdn', base: '/site/' });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation.error));
	const directory = join(served.root, 'dist', 'cdn');
	assert.ok(!existsSync(join(directory, 'm', 'tiny@1.0.0')), 'what the CDN holds is not written');
	const html = readFileSync(join(directory, 'index.html'), 'utf8');
	const map = JSON.parse(/<script type="importmap">\n([\s\S]*?)\n<\/script>/.exec(html)[1]);
	assert.ok(map.imports.tiny.startsWith(`${cdn.origin}${TINY}?`), map.imports.tiny);
	assert.equal(map.integrity[map.imports.tiny], `sha256-${createHash('sha256').update(tiny).digest('base64')}`, 'the digest the CDN answered for its bytes');
	assert.equal(map.imports['@production/web/main'], '/site/m/@production/web@1.0.0/modules/main.js');
	const manifest = JSON.parse(readFileSync(join(directory, 'beyond-export.json'), 'utf8'));
	assert.deepEqual(manifest.cdn.modules.map(({ specifier, integrity }) => [specifier, integrity]), [['tiny', map.integrity[map.imports.tiny]]]);
	assert.equal(manifest.cdn.origin, cdn.origin);
});

test('an earlier export is replaced only when named; an unknown target and a source that does not build fail with their codes', { timeout: 600000 }, async () => {
	const directory = join(served.root, 'dist', 'web');
	const before = readFileSync(join(directory, 'beyond-export.json'), 'utf8');
	const again = await exported({ application: 'site', target: 'web', destination: 'dist/web' });
	assert.deepEqual([again.state, again.error.code], ['failed', 'EXPORT_DESTINATION_CONFLICT']);
	assert.equal(again.error.details.replace, JSON.parse(before).id);

	const unknown = await exported({ application: 'site', target: 'admin', destination: 'dist/admin' });
	assert.equal(unknown.error.code, 'TARGET_NOT_FOUND');

	const lazy = join(served.root, 'web', 'lazy', 'index.ts');
	const source = readFileSync(lazy, 'utf8');
	// The service sees an edit through its watchers: the export starts once the module answers what the edit made of it
	const answers = async status => {
		const deadline = Date.now() + 60000;
		while ((await served.send('GET', `${LAZY}?target=browser&format=esm&env=production&min=true&sourcemap=none`)).status !== status) {
			if (Date.now() > deadline) throw new Error(`${LAZY} did not answer ${status} within 60 s`);
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	};
	writeFileSync(lazy, 'export const lazy = (): string => {\n');
	try {
		await answers(422);
		const broken = await exported({ application: 'site', target: 'web', destination: 'dist/web', replace: JSON.parse(before).id });
		assert.deepEqual([broken.state, broken.error.code], ['failed', 'EXPORT_GRAPH_INCOMPLETE']);
		assert.ok(broken.error.details.diagnostics.length, JSON.stringify(broken.error));
		assert.equal(readFileSync(join(directory, 'beyond-export.json'), 'utf8'), before, 'the earlier export is untouched');
	} finally {
		writeFileSync(lazy, source);
	}
	await answers(200);
	const replaced = await exported({ application: 'site', target: 'web', destination: 'dist/web', replace: JSON.parse(before).id });
	assert.equal(replaced.state, 'succeeded', JSON.stringify(replaced.error));
	assert.notEqual(JSON.parse(readFileSync(join(directory, 'beyond-export.json'), 'utf8')).id, JSON.parse(before).id);
});

test('served by an independent host after the service stopped, the page renders, reloads, opens a deep route and loads its lazy module', { timeout: 300000 }, async () => {
	const origin = served.origin;
	await served.stop();
	stopped = true;
	await assert.rejects(fetch(`${origin}/session`, { signal: AbortSignal.timeout(5000) }), 'the development service is gone');

	const host = await new StaticHost(join(served.root, 'dist', 'web')).start();
	hosts.push(host);
	browser = await new Browser().start();
	const { page, observed } = await browser.page();
	await page.goto(`${host.origin}/`);
	const home = await Browser.rendered(page);
	assert.deepEqual(home, { greeting: 'Hello browser, from the export', route: '/', tiny: 'TINY!', color: 'rgb(12, 74, 110)', width: '24px', badge: 24 });
	assert.equal(await Browser.lazy(page), 'lazy module loaded');
	assert.ok(observed.requests.some(url => url.endsWith('/m/@production/web@1.0.0/modules/lazy.js')), 'the lazy module was loaded when asked for');

	await page.reload();
	assert.equal((await Browser.rendered(page)).greeting, 'Hello browser, from the export');
	await page.goto(`${host.origin}/catalog/item/42`);
	assert.equal((await Browser.rendered(page)).route, '/catalog/item/42', 'a deep route is answered by the page');

	assert.deepEqual(observed.failed, []);
	assert.deepEqual(observed.errors, []);
	assert.ok(observed.requests.every(url => url.startsWith(host.origin) || url.startsWith('data:')), observed.requests.filter(url => !url.startsWith(host.origin)).join('\n'));
	await page.close();
});

test('the cdn page loads the installed package from the CDN with its integrity, under its base', { timeout: 300000 }, async () => {
	const host = await new StaticHost(join(served.root, 'dist', 'cdn'), { base: '/site/' }).start();
	hosts.push(host);
	const { page, observed } = await browser.page();
	await page.goto(`${host.origin}/site/pages/about`);
	const rendered = await Browser.rendered(page);
	assert.deepEqual([rendered.greeting, rendered.route, rendered.tiny], ['Hello browser, from the export', '/site/pages/about', 'TINY!']);
	assert.equal(await Browser.lazy(page), 'lazy module loaded');
	assert.ok(observed.requests.some(url => url.startsWith(`${cdn.origin}${TINY}`)), 'the installed package came from the CDN');
	assert.ok(observed.requests.every(url => url.startsWith(host.origin) || url.startsWith(cdn.origin) || url.startsWith('data:')));
	assert.deepEqual([observed.failed, observed.errors], [[], []]);
	await page.close();
});
