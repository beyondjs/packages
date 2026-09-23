/**
 * Updates of a running page in a real browser, with the page's own development runtime: what is applied,
 * what is refused, what is kept, and when the page is told that it is stale.
 *
 * Three pages run the same application. Two open the preview document of the real development service,
 * which loads ES modules through the browser's import map: one keeps the registration the document made,
 * with the event stream of the service; the other registers its runtime again with the event stream of an
 * external emitter at another origin (the relay of the unified-runtime validation, a stand-in). The third
 * page (`pages/system.html`) loads the same modules and their updates as `System.register` modules with
 * SystemJS, through the service's import map for that format. Every step edits a file and asks every page
 * what its runtime applied.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Browser, Fork, Host, Runtime, Workspace, results, step } from './harness.mjs';
import { Relay } from '../unified-runtime/relay.mjs';
import { Viewer } from './viewer.mjs';
import { SystemPage } from './system.mjs';

const { BEE_URL, WATCHERS_URL } = process.env;
if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the Engine servers of Packages and of the watchers utility.');

const WEB = '@fixture/web@0.1.0/main';
const fork = new Fork();
const cleanup = [];
const workspace = await new Workspace().create(new Runtime());
cleanup.push(() => workspace.destroy());

// A port that is free now, so the service can be started again at the same origin
const port = await new Promise(resolve => {
	const probe = createServer().listen(0, '127.0.0.1', () => {
		const { port } = probe.address();
		probe.close(() => resolve(port));
	});
});
const launch = { implementation: BEE_URL, watchers: WATCHERS_URL, port, BEYOND_ESBUILD_COMPILER: fork.file };

let host, relay, browser, system;
const viewers = [];

const source = (...parts) => workspace.file('web/main', ...parts);
const rewrite = async (file, mutate) => writeFile(source(file), mutate(await readFile(source(file), 'utf8')));
const every = action => Promise.all(viewers.map(viewer => action(viewer)));
const same = (values, expected, message) => assert.deepEqual(values, viewers.map(() => expected), message);
const text = expected => every(viewer => viewer.text(expected));
const until = (type, value) => every(viewer => viewer.until(type, value));
const reported = async (type, from) => (await every(viewer => viewer.events(from[viewers.indexOf(viewer)]))).map(events => events.filter(([name]) => name === type));

try {
	await step('service: the preview links the stylesheet of the entry module in the document', async () => {
		host = await new Host().start(workspace.root, launch);
		cleanup.push(() => host.stop());

		const { modules, updates } = await (await fetch(`${host.origin}/preview/entry.json`)).json();
		const entry = modules.find(({ vspecifier }) => vspecifier === WEB);
		assert.deepEqual([entry.source, entry.scope, typeof entry.styles], ['environment', 'document', 'string'], JSON.stringify(entry));
		assert.equal(updates.runtime, '@beyond-js/local-2026/main');
		return `${host.origin}, ${modules.length} modules`;
	});

	await step('browser: a page registered by the document, a page registered with an external emitter and a SystemJS page', async () => {
		relay = await new Relay().start(`${host.origin}/events`);
		cleanup.push(() => relay.stop());
		browser = await new Browser().start();
		cleanup.push(() => browser.stop());

		const { updates } = await (await fetch(`${host.origin}/preview/entry.json`)).json();
		viewers.push(await new Viewer('browser/stream', await browser.page()).open(`${host.origin}/preview/`));
		viewers.push(await new Viewer('browser/relay', await browser.page()).open(`${host.origin}/preview/`));
		await viewers[1].register({ events: relay.url, options: updates.session.options, session: updates.session });
		system = await new SystemPage().start(host.origin);
		cleanup.push(() => system.stop());
		viewers.push(await new Viewer('browser/systemjs', await browser.page(), true).open(system.url));

		// The runtime of the SystemJS page was itself loaded as a System.register module: its import() is SystemJS's
		const registered = await viewers[2].page.evaluate(() => [...System.entries()].map(([url]) => url));
		assert.ok(registered.some(url => url.includes('/@beyond-js/local-2026@0.1.0/modules/main?') && url.includes('format=system')), JSON.stringify(registered));

		const described = await every(viewer => viewer.describe());
		same(described, { state: 'ready', platform: 'web', environment: 'browser', loader: 'module', source: 'stream' });
		same(await every(viewer => viewer.shown()), '[environment] Hello preview | Count: 0');
		same(await every(viewer => viewer.ink()), 'rgb(10, 20, 30)');
		same((await every(viewer => viewer.links())).map(links => links.length), 1);

		await every(async viewer => (await viewer.click(), await viewer.click()));
		await every(viewer => viewer.page.evaluate(() => (window.marker = document.querySelector('fixture-counter'))));
		return `${browser.version}; relay ${relay.url}; SystemJS page ${system.url}`;
	});

	await step('update: a saved source changes every running page, and what a reload destroys is intact', async () => {
		await rewrite('view.ts', code => code.replace('Count: ${count}', 'Clicks: ${count}'));
		await text('Clicks: 2');
		await until('applied', WEB);

		same(await every(viewer => viewer.shown()), '[environment] Hello preview | Clicks: 2', 'The state of the internal module was kept');
		same(await every(viewer => viewer.page.evaluate(() => window.marker === document.querySelector('fixture-counter'))), true);
		same(await every(viewer => viewer.page.evaluate(() => window.evaluated)), { store: 1 });
		same(await every(viewer => viewer.observed.navigations.length), 1, 'No page navigated');

		// SystemJS evaluated the update in its own registry, from the System.register form of the update route
		const registered = await viewers[2].page.evaluate(() => [...System.entries()].map(([url]) => url));
		assert.ok(registered.some(url => /\/u\/[0-9a-f]{32}\/@fixture\/web@0\.1\.0\/modules\/main\?.*format=system/.test(url)), JSON.stringify(registered));
	});

	await step('invalid build: a source that does not compile changes nothing, and its correction is applied', async () => {
		const valid = await readFile(source('view.ts'), 'utf8');
		await writeFile(source('view.ts'), 'export const label = ;\n');
		await until('invalid', WEB);
		await every(viewer => viewer.click());
		same(await every(viewer => viewer.shown()), '[environment] Hello preview | Clicks: 3');

		await writeFile(source('view.ts'), valid.replace('Clicks: ${count}', 'Total: ${count}'));
		await text('Total: 3');
		same(await every(viewer => viewer.page.evaluate(() => window.evaluated)), { store: 1 });
	});

	await step('evaluation failure: a source that throws when evaluated fails its update, and its correction is applied', async () => {
		const valid = await readFile(source('view.ts'), 'utf8');
		const from = viewers.map(viewer => viewer.seen);
		await writeFile(source('view.ts'), `throw new Error('evaluation failed');\n${valid}`);
		await until('error', WEB);
		const errors = await reported('error', from);
		assert.ok(errors.every(events => events.some(([, name, message]) => name === WEB && /evaluation failed/.test(message))), JSON.stringify(errors));

		await writeFile(source('view.ts'), valid.replace('Total: ${count}', 'Sum: ${count}'));
		await text('Sum: 3');
		await every(viewer => viewer.click());
		same(await every(viewer => viewer.shown()), '[environment] Hello preview | Sum: 4');
		same(await every(viewer => viewer.page.evaluate(() => window.evaluated)), { store: 1 });
	});

	await step('stylesheet: the link of the document is replaced; an invalid sheet keeps the last valid one until its correction', async () => {
		const valid = await readFile(source('page.scss'), 'utf8');
		await writeFile(source('page.scss'), valid.replace('rgb(10, 20, 30)', 'rgb(40, 50, 60)'));
		await every(viewer => viewer.page.waitForFunction(() => getComputedStyle(document.body).color === 'rgb(40, 50, 60)', null, { timeout: 60000 }));
		const links = await every(viewer => viewer.links());
		assert.ok(links.every(hrefs => hrefs.length === 1 && /\/u\/[0-9a-f]{32}\/@fixture\/web@0\.1\.0\/styles\/main\?/.test(hrefs[0])), JSON.stringify(links));

		await writeFile(source('page.scss'), valid.replace('$ink;', '$missing;'));
		await until('invalid', WEB);
		same(await every(viewer => viewer.ink()), 'rgb(40, 50, 60)', 'The last valid stylesheet is kept');
		assert.deepEqual(await every(viewer => viewer.links()), links);

		await writeFile(source('page.scss'), valid.replace('rgb(10, 20, 30)', 'rgb(70, 80, 90)'));
		await every(viewer => viewer.page.waitForFunction(() => getComputedStyle(document.body).color === 'rgb(70, 80, 90)', null, { timeout: 60000 }));
		same((await every(viewer => viewer.links())).map(hrefs => hrefs.length), 1);
	});

	await step('stylesheet that fails to load: the previous link is kept and the failure is reported', async () => {
		// The browser is refused the new sheet, whatever the service would answer
		const refuse = route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
		const sheet = url => url.pathname.startsWith('/u/') && url.pathname.endsWith('/@fixture/web@0.1.0/styles/main');
		await every(viewer => viewer.page.route(sheet, refuse));
		const from = viewers.map(viewer => viewer.seen);
		const before = await every(viewer => viewer.links());

		await rewrite('page.scss', code => code.replace('rgb(70, 80, 90)', 'rgb(90, 90, 90)'));
		await until('error', WEB);
		const errors = await reported('error', from);
		assert.ok(errors.every(events => events.some(([, name, message]) => name === WEB && /could not be loaded/.test(message))), JSON.stringify(errors));
		same(await every(viewer => viewer.ink()), 'rgb(70, 80, 90)', 'The last stylesheet that loaded is kept');
		assert.deepEqual(await every(viewer => viewer.links()), before);

		await every(viewer => viewer.page.unroute(sheet, refuse));
		await rewrite('page.scss', code => code.replace('rgb(90, 90, 90)', 'rgb(100, 110, 120)'));
		await every(viewer => viewer.page.waitForFunction(() => getComputedStyle(document.body).color === 'rgb(100, 110, 120)', null, { timeout: 60000 }));
	});

	await step('order: two edits saved in quick succession end in the last one, without errors', async () => {
		const from = viewers.map(viewer => viewer.seen);
		await rewrite('view.ts', code => code.replace('Sum: ${count}', 'Step 1: ${count}'));
		await new Promise(resolve => setTimeout(resolve, 60));
		await rewrite('view.ts', code => code.replace('Step 1: ${count}', 'Step 2: ${count}'));
		await text('Step 2: 4');
		await until('applied', WEB);
		same(await every(viewer => viewer.shown()), '[environment] Hello preview | Step 2: 4');
		same((await reported('error', from)).map(events => events.length), 0);
	});

	await step('restart boundary: after the service restarts, every page is told it is stale and applies nothing more', async () => {
		const from = viewers.map(viewer => viewer.seen);
		await host.stop();
		host = await new Host().start(workspace.root, launch);
		cleanup.push(() => host.stop());

		await until('stale');
		same((await reported('stale', from)).map(events => events.map(([, reason]) => reason)), ['EPOCH']);

		// The next build reaches every page, which applies nothing of it
		const after = relay.events.length;
		await rewrite('view.ts', code => code.replace('Step 2: ${count}', 'After restart: ${count}'));
		const { build } = await relay.until(({ type, build }) => type === 'build.ended' && build.state === 'completed' && build.modules.some(({ vspecifier }) => vspecifier === WEB), after);
		await until('notified', build.id);
		same(await every(viewer => viewer.shown()), '[environment] Hello preview | Step 2: 4', 'Nothing is applied: a reload is required');
		same(await every(viewer => viewer.observed.navigations.length), 1, 'Nothing reloaded the page');
	});

	await step('lifecycle: closing releases the connection in every page', async () => {
		same(await every(viewer => viewer.close()), false);
		// What the steps caused on purpose: the failed update, the refused sheet and the stream the restart ended
		const expected = /evaluation failed|could not be loaded|Failed to load resource/;
		same(await every(viewer => viewer.observed.errors.filter(message => !expected.test(message))), []);
	});
} finally {
	const failed = results.some(result => !result.ok);
	failed && host && console.log(`--- service log ---\n${host.log.slice(-3000)}`);
	for (const viewer of viewers) failed && console.log(`--- ${viewer.name} ---\n${JSON.stringify({ observed: viewer.observed, events: await viewer.events().catch(() => []) }, null, 1)}`);
	for (const task of cleanup.reverse()) await Promise.resolve().then(task).catch(error => console.log(`cleanup: ${error.message}`));
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
