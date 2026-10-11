import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SameOrigin } from '../host/same-origin.mjs';
import { BROWSER, compose, EMBED, EVIL } from './support/paired.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };
const MODULE = `/m/@a/b@1.0.0/modules/main?${BROWSER}`;
const code = refused => [refused.status, refused.body?.error?.code];
const allowed = answer => answer.headers['access-control-allow-origin'];

test('a loopback service that does not pair keeps its access, with the corrections every service receives', async t => {
	const { send, ports } = await compose(t, { pairing: false });
	const read = await send('GET', '/session', { origin: EVIL });
	assert.equal(read.status, 200, 'it keeps its access');
	assert.equal(allowed(read), undefined, 'but only compiled modules carry cross-origin headers');
	assert.deepEqual(code(await send('GET', '/session', { host: `evil.example:${ports.api}` })), [403, 'HOST_REFUSED']);
	for (const path of ['/pairing/codes', '/pairing', '/exports']) assert.equal((await send('POST', path, JSON_TYPE, '{}')).status, 404, path);
});

test('its compiled modules are read across origins by its own origin and its embed origins only', async t => {
	const { send, api } = await compose(t, { pairing: false });
	assert.equal(allowed(await send('GET', MODULE)), '*', 'a process, or a page of its own origin, as before');
	assert.equal(allowed(await send('GET', MODULE, { origin: api })), '*', "Conduict's proxy sends the service's own origin");
	const foreign = await send('GET', MODULE, { origin: EVIL });
	assert.equal(foreign.status, 200, 'the module is still answered');
	assert.equal(allowed(foreign), undefined, 'a page of another origin does not read it');
	assert.match(String(foreign.headers.vary), /Origin/);
	for (const path of [`/m/@a/b@1.0.0/modules/absent?${BROWSER}`, '/resolution.json?target=browser']) {
		assert.equal(allowed(await send('GET', path, { origin: EVIL })), undefined, path);
	}
	const preflight = await send('OPTIONS', MODULE, { origin: EVIL, 'access-control-request-method': 'GET' });
	assert.equal(allowed(preflight), undefined, 'nor passes its preflight');

	const embedded = await compose(t, { pairing: false, environment: { BEYOND_EMBED_ORIGINS: EMBED } });
	assert.equal(allowed(await embedded.send('GET', MODULE, { origin: EMBED })), '*', 'an embed origin reads them');
	assert.equal(allowed(await embedded.send('GET', MODULE, { origin: EVIL })), undefined);
	const every = await compose(t, { pairing: false, environment: { BEYOND_EMBED_ORIGINS: '*' } });
	assert.equal(allowed(await every.send('GET', MODULE, { origin: EVIL })), '*', 'every origin, when asked for');
	assert.throws(() => new SameOrigin({ environment: { BEYOND_EMBED_ORIGINS: 'site.example' } }), /neither "\*" nor an http or https origin/);
});

test('a page of another origin changes nothing, a build included, and cannot attach (CSRF)', async t => {
	const { send, stream, writes, builds } = await compose(t, { pairing: false });
	const batch = '{"mutations":[]}';
	assert.deepEqual(code(await send('POST', '/files/operations', { origin: EVIL, 'content-type': 'text/plain' }, batch)), [403, 'ORIGIN_REFUSED']);
	for (const path of ['/builds', '/builds/bld_1/cancel']) {
		assert.deepEqual(code(await send('POST', path, { origin: EVIL })), [403, 'ORIGIN_REFUSED'], `a bodyless ${path} of another site`);
		assert.deepEqual(code(await send('POST', path, { origin: 'null' })), [403, 'ORIGIN_REFUSED'], `${path} from an opaque origin`);
	}
	for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: EVIL }]) {
		assert.deepEqual(code(await send('GET', '/attach?kind=session', headers)), [403, 'ORIGIN_REFUSED'], JSON.stringify(headers));
	}
	assert.deepEqual([writes, builds], [[], []], 'nothing ran');

	const attached = await stream('/attach?kind=session');
	await attached.until('attached');
	attached.close();
});

test("the path of Conduict's development proxy stays allowed: the loopback Host, and the service's own Origin or none", async t => {
	const { send, stream, writes, builds, api, ports } = await compose(t, { pairing: false });
	const host = `127.0.0.1:${ports.api}`;
	assert.equal((await send('POST', '/files/operations', { host, origin: api, ...JSON_TYPE }, '{"mutations":[]}')).status, 200);
	assert.equal((await send('POST', '/builds', { host, origin: api })).status, 202);
	assert.equal((await send('POST', '/builds/bld_1/cancel', { host })).status, 202);
	assert.deepEqual([writes, builds], [['{"mutations":[]}'], ['/builds', '/builds/bld_1/cancel']]);

	// A page of the service's own origin, such as a preview it serves, attaches as before
	const attached = await stream('/attach?kind=session', { host, 'sec-fetch-site': 'same-origin' });
	assert.equal(attached.status, 200);
	await attached.until('attached');
	attached.close();
});

test('a loopback service with delegated access, and one on another address, keep the rules they had', async t => {
	for (const options of [{ environment: { BEYOND_AUTHORITY: '{}' } }, { bind: '0.0.0.0' }]) {
		const { send, builds } = await compose(t, { pairing: false, ...options });
		assert.equal(allowed(await send('GET', MODULE, { origin: EVIL })), '*', JSON.stringify(options));
		assert.equal((await send('POST', '/builds', { origin: EVIL })).status, 202, 'grants or the network decide there');
		assert.deepEqual(builds, ['/builds']);
	}
});
