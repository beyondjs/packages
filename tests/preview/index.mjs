/**
 * The preview of a workspace in a real browser, through the real development service in delegated mode:
 * the explicit development selection, the entry document that routes selected modules to the environment
 * and the others to the CDN, and an update applied to the running page by the development runtime, which
 * is told apart from a reload by what a reload destroys.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Authority, Browser, Events, Fork, Gateway, Host, Origin, Runtime, Workspace, results, step } from './harness.mjs';

const { BEE_URL, WATCHERS_URL } = process.env;
if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the Engine servers of Packages and of the watchers utility.');

const WEB = '@fixture/web@0.1.0/main';
const SHARED = '/m/@fixture/shared@0.1.0/modules/text';
const PUBLISHED = 'target=browser&format=esm&env=production&min=true&sourcemap=external&types=false&css=false';

const fork = new Fork();
const authority = new Authority();
const owner = authority.grant(['session.read', 'files.read', 'files.write', 'events.subscribe', 'inspect.read', 'build.control', 'artifacts.read']);
// A visitor never reads the session of the service: the document gives the runtime what it needs of it
const visitor = authority.grant(['events.subscribe', 'artifacts.read'], { subject: 'usr_visitor1' });

const cleanup = [];
const workspace = await new Workspace().create(new Runtime());
cleanup.push(() => workspace.destroy());

let host, gateway, cdn, browser, events, page, observed;

const call = async (method, path, { grant = owner, body, headers = {} } = {}) => {
	const response = await fetch(host.origin + path, { method, body, redirect: 'manual', headers: { ...(grant ? { authorization: `Bearer ${grant}` } : {}), ...headers } });
	const text = await response.text();
	try {
		return { status: response.status, headers: response.headers, body: JSON.parse(text) };
	} catch {
		return { status: response.status, headers: response.headers, body: text };
	}
};
const select = packages => call('PUT', '/development/selection', { body: JSON.stringify({ packages }) });
const source = (...parts) => workspace.file(...parts);
const rewrite = async (file, mutate) => writeFile(file, mutate(await readFile(file, 'utf8')));
const shown = () => page.locator('fixture-counter p').textContent();
const until = (text, ms = 30000) => page.waitForFunction(expected => document.querySelector('fixture-counter')?.shadowRoot?.querySelector('p')?.textContent.includes(expected), text, { timeout: ms });

try {
	await step('service: delegated access guards the preview, the selection and the updates', async () => {
		cdn = await new Origin().module(SHARED, `export const greet = subject => '[cdn] Hello ' + subject;\n`).start();
		cleanup.push(() => cdn.stop());

		const launch = { implementation: BEE_URL, watchers: WATCHERS_URL, BEYOND_ESBUILD_COMPILER: fork.file, BEYOND_CDN_ORIGIN: cdn.origin };
		host = await new Host().start(workspace.root, { ...launch, ...authority.environment, headers: { authorization: `Bearer ${owner}` } });
		cleanup.push(() => host.stop());

		for (const path of ['/preview/', '/preview/entry.json', '/development/selection', `/u/${'0'.repeat(32)}${SHARED.slice(2)}`]) {
			assert.equal((await call('GET', path, { grant: null })).status, 401, path);
		}
		const state = (await call('GET', '/state')).body;
		assert.deepEqual(state.modules.filter(module => module.specifier.startsWith('@fixture/shared') && module.status !== 'valid'), []);
		return `${host.origin}, stand-in CDN ${cdn.origin}`;
	});

	await step('default: until somebody selects, every workspace package is in development and every address is relative', async () => {
		const selection = (await call('GET', '/development/selection')).body;
		assert.deepEqual(selection, { explicit: false, packages: ['@beyond-js/local-2026', '@fixture/shared', '@fixture/web'], modules: [], unknown: [] });

		const entry = (await call('GET', '/preview/entry.json', { grant: visitor })).body;
		assert.equal(entry.entry.vspecifier, WEB, 'The entry is the only browser module that nothing imports');
		assert.deepEqual(entry.modules.map(({ source }) => source), ['environment', 'environment', 'environment', 'environment']);
		assert.ok(Object.values(entry.importmap.imports).every(url => url.startsWith('../m/')));
		assert.equal(entry.updates.runtime, '@beyond-js/local-2026/main');
		assert.equal((await call('GET', '/session', { grant: visitor })).status, 403, 'the visitor cannot read the session of the service');
		assert.deepEqual(Object.keys(entry.updates.session.modules).sort(), entry.modules.map(({ specifier }) => specifier).sort(), 'and is given the modules in development instead');
		assert.ok(Object.values(entry.updates.session.modules).every(({ path }) => path.startsWith('/m/')));

		const redirect = await call('GET', '/preview?entry=@fixture/web/main', { grant: visitor });
		assert.deepEqual([redirect.status, redirect.headers.get('location')], [308, 'preview/?entry=@fixture/web/main']);

		const document = (await call('GET', '/preview/', { grant: visitor })).body;
		for (const secret of [visitor, owner, 'Bearer', host.origin, 'file:', workspace.root]) assert.ok(!document.includes(secret), `The document must not contain "${secret.slice(0, 12)}…"`);
		assert.ok(document.includes('session: {'), 'it registers the runtime with the session it embeds');
		return `${entry.modules.length} modules, entry ${entry.entry.specifier}`;
	});

	await step('selection: only a replacement changes it; files do not, a viewer cannot, and it is not a source file', async () => {
		assert.equal((await call('PUT', '/development/selection', { grant: visitor, body: '{}' })).body.error.code, 'GRANT_CAPABILITY');
		const refused = await select(['@fixture/web', '@fixture/missing']);
		assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.unknown], [400, 'SELECTION_INVALID', ['@fixture/missing']]);

		const selected = (await select(['@fixture/web', '@beyond-js/local-2026'])).body;
		assert.deepEqual([selected.explicit, selected.packages], [true, ['@beyond-js/local-2026', '@fixture/web']]);
		assert.ok(existsSync(source('.beyond/development/selection.json')) && existsSync(source('.beyond/.gitignore')));

		// Reading and writing a file of a package that is not selected leaves the selection as it was
		const path = '/files/content/shared/text/index.ts';
		const read = await call('GET', path);
		const written = await call('PUT', path, { body: `${read.body}\n// edited\n`, headers: { 'if-match': read.headers.get('etag') } });
		assert.equal(written.body.outcome, 'completed');
		assert.deepEqual((await call('GET', '/development/selection')).body, selected);

		const tree = (await call('GET', '/files/tree?scan=true')).body;
		assert.deepEqual(tree.entries.filter(({ path: name }) => name.startsWith('.beyond')), []);
		assert.equal((await call('PUT', '/files/content/.beyond/development/selection.json', { body: '{}', headers: { 'if-none-match': '*' } })).body.error.code, 'PATH_FORBIDDEN');

		const entry = (await call('GET', '/preview/entry.json')).body;
		const shared = entry.modules.find(({ specifier }) => specifier === '@fixture/shared/text');
		assert.deepEqual(shared, { specifier: '@fixture/shared/text', source: 'cdn', version: '0.1.0', url: `${cdn.origin}${SHARED}?${PUBLISHED}` });
		return 'explicit; the module that is not selected resolves to the CDN at the workspace version';
	});

	await step('browser: the document renders behind a path prefix, with the module that is not selected loaded from the CDN', async () => {
		gateway = await new Gateway().start(host.origin, '/environments/env_shop0001/visitor', visitor);
		cleanup.push(() => gateway.stop());
		browser = await new Browser().start();
		cleanup.push(() => browser.stop());

		const first = await browser.page();
		await first.page.goto(`${gateway.base}/preview`);
		await first.page.waitForSelector('fixture-counter');
		assert.equal(await first.page.locator('fixture-counter p').textContent(), '[cdn] Hello preview | Count: 0');
		assert.equal(await first.page.locator('fixture-counter button').evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(12, 74, 110)');
		assert.deepEqual(cdn.requests, [`${SHARED}?${PUBLISHED}`]);
		assert.deepEqual([first.observed.errors, first.observed.refused], [[], []]);
		await first.page.close();
		return `${browser.version}; ${gateway.requests.filter(([, path]) => path.startsWith('/m/')).length} modules from the environment, 1 from the CDN`;
	});

	await step('browser: with every package selected, everything comes from the environment', async () => {
		await select(['@fixture/web', '@fixture/shared', '@beyond-js/local-2026']);
		events = await new Events().open(`${host.origin}/events`, visitor);
		cleanup.push(() => events.close());

		({ page, observed } = await browser.page());
		await page.goto(`${gateway.base}/preview/`);
		await until('[environment] Hello preview | Count: 0');
		assert.equal(cdn.requests.length, 1, 'Nothing else was asked of the CDN');
		assert.ok(gateway.requests.some(([, path]) => path.startsWith('/events')), 'The runtime subscribed through the gateway');
	});

	await step('update: a saved source changes the running page, and what a reload destroys is intact', async () => {
		await page.locator('fixture-counter button').click();
		await page.locator('fixture-counter button').click();
		assert.equal(await shown(), '[environment] Hello preview | Count: 2');
		await page.evaluate(() => (window.marker = document.querySelector('fixture-counter')));
		const before = { navigations: observed.navigations.length, documents: gateway.requests.filter(([, path]) => path.startsWith('/preview')).length };

		await rewrite(source('web/main/view.ts'), text => text.replace('Count: ${count}', 'Clicks: ${count}'));
		await until('Clicks: 2');

		assert.equal(await shown(), '[environment] Hello preview | Clicks: 2', 'The state of the internal module was kept');
		assert.ok(await page.evaluate(() => window.marker === document.querySelector('fixture-counter')), 'The element is the one that was mounted');
		assert.deepEqual(await page.evaluate(() => window.evaluated), { store: 1 }, 'The stateful internal module was not evaluated again');
		assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), 1);
		assert.equal(observed.navigations.length, before.navigations, 'The page did not navigate');
		assert.equal(gateway.requests.filter(([, path]) => path.startsWith('/preview')).length, before.documents, 'The document was not requested again');

		const updates = gateway.requests.filter(([, path]) => path.startsWith('/u/'));
		assert.ok(updates.some(([, path]) => path.includes('/@fixture/web@0.1.0/modules/main?target=browser')), JSON.stringify(updates));

		await page.locator('fixture-counter button').click();
		assert.equal(await shown(), '[environment] Hello preview | Clicks: 3');
		return `${updates.length} update request(s) through the gateway`;
	});

	await step('update of another package: the public dependency is current through the original import', async () => {
		await rewrite(source('shared/text/index.ts'), text => text.replace('[environment] Hello', '[environment] Hi'));
		// The page reads the public module through its import map, which is the instance the application imported
		const greeting = () => page.evaluate(async () => (await import('@fixture/shared/text')).greet('x'));
		for (const deadline = Date.now() + 30000; (await greeting()) !== '[environment] Hi x'; await new Promise(done => setTimeout(done, 100))) {
			if (Date.now() > deadline) throw new Error('Timed out waiting for the update of the shared module');
		}

		await page.locator('fixture-counter button').click();
		assert.equal(await shown(), '[environment] Hi preview | Clicks: 4');
	});

	await step('failure and recovery: an invalid source changes nothing on the page, and its correction is applied', async () => {
		const file = source('web/main/view.ts');
		const valid = await readFile(file, 'utf8');
		const seen = events.messages.length;
		await writeFile(file, 'export const label = ;\n');
		await events.until(({ event, build }, index) => index >= seen && event === 'build.ended' && build.state === 'failed', 'the failed build');
		await page.locator('fixture-counter button').click();
		assert.equal(await shown(), '[environment] Hi preview | Clicks: 5');

		await writeFile(file, valid.replace('Clicks: ${count}', 'Total: ${count}'));
		await until('Total: 5');
		assert.deepEqual(await page.evaluate(() => window.evaluated), { store: 1 });
		assert.deepEqual(observed.errors.filter(text => !text.includes('invalid')), []);
	});

	await step('events: builds name the platform of each artifact, and a visitor receives no source event', async () => {
		const builds = events.messages.filter(({ event, build }) => event === 'build.ended' && build.state === 'completed');
		const modules = builds.at(-1).build.modules;
		assert.deepEqual(modules.filter(({ vspecifier }) => vspecifier === WEB).map(({ platform, status }) => [platform, status]), [['web', 'valid']]);
		assert.deepEqual(modules.filter(({ vspecifier }) => vspecifier === '@fixture/shared@0.1.0/text').map(({ platform }) => platform), ['node', 'web']);
		assert.deepEqual(events.messages.filter(({ event }) => /^(file|batch)\./.test(event)), [], 'The visitor grant has no files.read');
		return `${builds.length} completed builds observed by the visitor`;
	});
} finally {
	const failed = results.some(result => !result.ok);
	failed && host && console.log(`--- service log ---\n${host.log.slice(-3000)}`);
	failed && observed && console.log(`--- page ---\n${JSON.stringify(observed, null, 1)}`);
	for (const task of cleanup.reverse()) await Promise.resolve().then(task).catch(error => console.log(`cleanup: ${error.message}`));
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
