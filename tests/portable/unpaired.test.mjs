import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

const EVIL = 'https://evil.example';
const JSON_TYPE = { 'content-type': 'application/json' };
const BROWSER = 'target=browser&format=esm&env=development&min=false&sourcemap=inline';
const TEXT = '/m/@portable/app@1.0.0/modules/text';
const code = answer => [answer.status, answer.body?.error?.code];

/**
 * A service started without pairing, as the Conduict Machine Manager starts it behind its development proxy: it keeps its access,
 * with the corrections every service receives
 */
const served = new Served();
before(() => served.start({ pairing: false }), { timeout: 600000 });
after(() => served.stop(), { timeout: 120000 });

test('a service that does not pair has one listener and claims none of the pairing capabilities', () => {
	const { service, capabilities } = served.session;
	assert.equal(service.preview, undefined);
	for (const name of ['pairing', 'exports', 'ui']) assert.equal(capabilities[name], undefined, name);
	assert.equal(capabilities.files, 1);
	assert.equal(served.headers.authorization, undefined, 'no local credential is written for it');
});

test('only compiled modules are readable across origins, and only by the service\'s own origin', async () => {
	const session = await served.send('GET', '/session', { headers: { origin: EVIL } });
	assert.equal(session.status, 200, 'its access is kept');
	assert.equal(session.headers['access-control-allow-origin'], undefined, 'but no page of another site reads it');
	assert.equal((await served.send('GET', '/files/tree', { headers: { origin: EVIL } })).headers['access-control-allow-origin'], undefined);
	const foreign = await served.send('GET', `${TEXT}?${BROWSER}`, { headers: { origin: EVIL } });
	assert.equal(foreign.status, 200);
	assert.equal(foreign.headers['access-control-allow-origin'], undefined, 'a page of another origin reads no compiled module');
	assert.equal((await served.send('GET', `${TEXT}?${BROWSER}`)).headers['access-control-allow-origin'], '*', 'a process, as before');
	assert.equal((await served.send('GET', `${TEXT}?${BROWSER}`, { headers: { origin: served.origin } })).headers['access-control-allow-origin'], '*');
	const preflight = await served.send('OPTIONS', '/files/content/app/a.ts', { headers: { origin: EVIL, 'access-control-request-method': 'PUT' } });
	assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});

test('every request names a loopback host, a page of another origin changes nothing nor attaches, and .git is refused', async () => {
	for (const path of ['/session', `${TEXT}?${BROWSER}`, '/events', '/preview/']) {
		assert.deepEqual(code(await served.send('GET', path, { headers: { host: `evil.example:${served.port()}` } })), [403, 'HOST_REFUSED'], path);
	}
	const batch = JSON.stringify({ mutations: [{ operation: 'write', path: 'app/injected.ts', expected: 'absent', content: 'x' }] });
	assert.deepEqual(code(await served.send('POST', '/files/operations', { headers: { origin: EVIL, 'content-type': 'text/plain' }, body: batch })), [403, 'ORIGIN_REFUSED']);
	assert.deepEqual(code(await served.send('POST', '/files/operations', { headers: { 'content-type': 'text/plain' }, body: batch })), [415, 'CONTENT_TYPE_UNSUPPORTED']);
	assert.equal(existsSync(join(served.root, 'app', 'injected.ts')), false);
	for (const path of ['/builds', '/builds/bld_00000000/cancel']) {
		assert.deepEqual(code(await served.send('POST', path, { headers: { origin: EVIL } })), [403, 'ORIGIN_REFUSED'], `a bodyless ${path} of another site`);
	}
	const attach = await served.stream('/attach?kind=session', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' } });
	assert.equal(attach.status, 403, 'a page of another site does not keep the service alive');
	attach.close();
	assert.deepEqual(code(await served.send('PUT', '/files/content/app/sub/.git/config', { headers: { 'if-none-match': '*' }, body: 'x' })), [403, 'PATH_FORBIDDEN']);
});

test('the path of Conduict\'s development proxy stays allowed: the loopback Host and the service\'s own Origin', async () => {
	const headers = { host: `127.0.0.1:${served.port()}`, origin: served.origin, ...JSON_TYPE };
	const batch = JSON.stringify({ mutations: [{ operation: 'write', path: 'app/proxied.ts', expected: 'absent', content: 'export const proxied = 1;\n' }] });
	const completed = await served.send('POST', '/files/operations', { headers, body: batch });
	assert.equal(completed.body.outcome, 'completed', JSON.stringify(completed.body));
	assert.ok(existsSync(join(served.root, 'app', 'proxied.ts')));
	assert.equal((await served.send('GET', '/files/tree?path=app', { headers: { origin: served.origin } })).status, 200);
	const started = await served.send('POST', '/builds', { headers: { host: headers.host, origin: served.origin } });
	assert.equal(started.status, 202, JSON.stringify(started.body));
	assert.equal((await served.send('GET', `${TEXT}?${BROWSER}`, { headers: { host: headers.host, origin: served.origin } })).headers['access-control-allow-origin'], '*');
});
