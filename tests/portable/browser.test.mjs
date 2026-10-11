import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pages } from './support/pages.mjs';
import { Probe } from './support/probe.mjs';
import { Served } from './support/served.mjs';

/**
 * The browser probe of PKG-P01: a real service that pairs, started from this checkout, used from pages of an HTTPS
 * origin with a self-signed certificate and of a plain HTTP origin on a name that is not a loopback one, in Chromium,
 * Firefox and WebKit through `playwright-core` (`BEYOND_PLAYWRIGHT` names a directory where it is installed, with its
 * browsers installed). What each engine does is recorded (`BEYOND_PROBE_REPORT` names a file for the record) rather
 * than assumed: pairing, the session, the event stream, and in Chromium a page whose address is overridden as public,
 * which is how a hosted interface reaches a service on this machine. What must hold in every engine is asserted: a page
 * of another site reads nothing, writes nothing and cannot load a module of the preview listener as a classic script,
 * which the preview's own pages can, and code in a preview reaches no source and cannot pair.
 */
const ENGINES = ['chromium', 'firefox', 'webkit'];
const TIMEOUT = 20000;
const record = { engines: {} };
const pages = new Pages();
const served = new Served();
let playwright;

before(async () => {
	const { BEYOND_PLAYWRIGHT } = process.env;
	if (!BEYOND_PLAYWRIGHT) throw new Error('Set BEYOND_PLAYWRIGHT to a directory where "playwright-core" and its browsers are installed.');
	playwright = createRequire(pathToFileURL(join(resolve(BEYOND_PLAYWRIGHT), 'package.json')).href)('playwright-core');
	await pages.start();
	await served.start({ pairing: { origins: [pages.https, ...(pages.http ? [pages.http] : [])] } });
	record.service = { api: 'loopback', preview: 'loopback', http: pages.http ? 'a non-loopback address of this machine' : 'none: no non-loopback address' };
}, { timeout: 600000 });

after(async () => {
	await served.stop();
	await pages.stop();
	const report = JSON.stringify(record, null, '\t');
	process.env.BEYOND_PROBE_REPORT && writeFileSync(process.env.BEYOND_PROBE_REPORT, `${report}\n`);
	console.log(report);
}, { timeout: 120000 });

/**
 * Opens a page of an origin in a fresh context and runs a step of the probe in it, recording what happened
 */
const visit = async (browser, origin, step, values, options = {}) => {
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const seen = [];
	try {
		options.grant && (await context.grantPermissions([options.grant]).catch(error => seen.push(`permission ${options.grant}: ${error.message.split('\n')[0]}`)));
		const page = await context.newPage();
		page.on('console', message => message.type() === 'error' && seen.push(message.text().slice(0, 200)));
		page.on('requestfailed', request => seen.push(`failed ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
		page.on('request', request => request.headers()['access-control-request-private-network'] && seen.push('private network preflight'));
		await page.goto(`${origin}${options.path ?? '/'}`, { timeout: 60000 });
		options.ready && (await page.waitForFunction(options.ready, null, { timeout: 90000 }));
		return { ...(await page.evaluate(step, values)), seen };
	} catch (error) {
		return { error: String(error.message).split('\n')[0], seen };
	} finally {
		await context.close();
	}
};

for (const engine of ENGINES) {
	test(`${engine}: pairs from the allowed origins, and no other page reads or writes anything`, { timeout: 600000 }, async () => {
		const browser = await playwright[engine].launch({ headless: true });
		const observed = (record.engines[engine] = { version: browser.version() });
		try {
			const api = served.origin;
			observed.https = await visit(browser, pages.https, Probe.pair, { api, code: (await served.pairing.code()).code, timeout: TIMEOUT });
			if (pages.http) observed.http = await visit(browser, pages.http, Probe.pair, { api, code: (await served.pairing.code()).code, timeout: TIMEOUT });

			observed.foreign = await visit(browser, pages.foreign, Probe.foreign, { api, timeout: TIMEOUT });
			assert.ok(!('read' in observed.foreign.session) || observed.foreign.session.read === 401, JSON.stringify(observed.foreign.session));
			assert.ok(!('read' in observed.foreign.secret), `a page of another site read a source: ${JSON.stringify(observed.foreign.secret)}`);
			assert.equal(existsSync(join(served.root, 'app', 'injected.ts')), false, 'a text body of another site wrote nothing');

			// A classic script of another site would run a module with a shim of its own; the preview's own pages load it
			const system = `${served.preview}/m/@portable/app@1.0.0/modules/text?target=browser&format=system&env=development&min=false&sourcemap=inline`;
			observed.script = await visit(browser, pages.elsewhere, Probe.script, { src: system, timeout: TIMEOUT });
			assert.equal(observed.script.script, 'refused', `a page of another site loaded a module: ${JSON.stringify(observed.script)}`);
			observed.own = await visit(browser, served.preview, Probe.script, { src: system, timeout: TIMEOUT }, { path: '/preview/?entry=%40portable%2Fapp%2Fmain' });
			assert.equal(observed.own.script, 'loaded', JSON.stringify(observed.own));

			const unused = (await served.pairing.code()).code;
			const preview = `${served.preview}/preview/?entry=${encodeURIComponent('@portable/app/main')}`;
			observed.preview = await visit(browser, served.preview, Probe.preview, { api, code: unused, timeout: TIMEOUT }, { path: preview.slice(served.preview.length), ready: () => document.body.dataset.greeting });
			assert.equal(observed.preview.greeting, 'Hello preview', JSON.stringify(observed.preview));
			assert.equal(observed.preview.source?.status, 404, 'a preview reaches no source');
			assert.ok(!observed.preview.pairing?.read || observed.preview.pairing.read >= 400, `code in a preview paired: ${JSON.stringify(observed.preview.pairing)}`);
			const still = await served.send('POST', '/pairing', { headers: { origin: pages.https, 'content-type': 'application/json' }, body: JSON.stringify({ code: unused }) });
			assert.equal(still.status, 201, 'the code the preview tried is unspent');
		} finally {
			await browser.close();
		}
	});
}

test('chromium: a page whose address is treated as public, as a hosted interface is, reaching the service on this machine', { timeout: 600000 }, async () => {
	const port = new URL(pages.https).port;
	const browser = await playwright.chromium.launch({ headless: true, args: [`--ip-address-space-overrides=127.0.0.1:${port}=public`] });
	try {
		record.hosted = { version: browser.version() };
		record.hosted.plain = await visit(browser, pages.https, Probe.pair, { api: served.origin, code: (await served.pairing.code()).code, timeout: TIMEOUT });
		record.hosted.granted = await visit(browser, pages.https, Probe.pair, { api: served.origin, code: (await served.pairing.code()).code, timeout: TIMEOUT }, { grant: 'local-network-access' });
	} finally {
		await browser.close();
	}
});
