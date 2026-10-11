import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Forwarding } from '../host/pairing/forwarding.mjs';
import { BROWSER, compose, EMBED, EVIL, UI } from './support/paired.mjs';

const MODULE = `/m/@a/b@1.0.0/modules/main?${BROWSER}`;
const NODE = '/m/@a/b@1.0.0/modules/main?target=node&format=esm&env=development&min=false&sourcemap=inline';
const code = refused => [refused.status, refused.body?.error?.code];

/**
 * The Fetch Metadata a browser sends with a classic `<script src>` of another site
 */
const SCRIPT = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };

test('a request that came through a proxy or a tunnel is never a local consumer', async t => {
	const { send, stream, local } = await compose(t);
	for (const proxy of [{ 'x-forwarded-for': '203.0.113.9' }, { forwarded: 'for=203.0.113.9' }, { via: '1.1 tunnel' }, { 'cf-connecting-ip': '203.0.113.9' }]) {
		for (const path of [NODE, '/session', '/attach?kind=session']) {
			const refused = await send('GET', path, proxy);
			assert.deepEqual(code(refused), [401, 'CREDENTIAL_REQUIRED'], `${JSON.stringify(proxy)} ${path}`);
			assert.match(refused.body.error.message, /proxy or a tunnel/);
		}
	}
	// The same process without those headers is a local consumer, and the credential is a local tool through a tunnel
	assert.equal((await send('GET', NODE)).status, 200);
	assert.equal((await send('GET', '/session', { 'x-forwarded-for': '203.0.113.9', ...local })).status, 200);
	const attached = await stream('/attach?kind=session');
	await attached.until('attached');
	attached.close();
	assert.equal(Forwarding.of({ host: '127.0.0.1:4000', accept: '*/*' }), undefined);
	assert.equal(Forwarding.of({ 'x-forwarded-proto': 'https' }), 'x-forwarded-proto');
});

test('the preview listener refuses the subresources of a page of another site, and serves its own pages', async t => {
	const { send, preview } = await compose(t);
	const refused = await send('GET', MODULE, SCRIPT, void 0, 'preview');
	assert.deepEqual(code(refused), [403, 'SITE_REFUSED'], 'a classic script of another site');
	for (const headers of [{ ...SCRIPT, referer: `${EVIL}/page` }, { ...SCRIPT, 'sec-fetch-mode': 'cors', origin: EVIL }, { ...SCRIPT, 'sec-fetch-dest': 'style' }, { ...SCRIPT, origin: 'null' }]) {
		assert.deepEqual(code(await send('GET', MODULE, headers, void 0, 'preview')), [403, 'SITE_REFUSED'], JSON.stringify(headers));
	}
	assert.deepEqual(code(await send('GET', '/events', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', origin: EVIL }, void 0, 'preview')), [403, 'SITE_REFUSED']);

	// Its own pages, what the person opens, a process, a page this machine serves on the same loopback site
	for (const site of ['same-origin', 'none', 'same-site', undefined]) {
		const headers = site ? { ...SCRIPT, 'sec-fetch-site': site } : {};
		assert.equal((await send('GET', MODULE, headers, void 0, 'preview')).status, 200, String(site));
	}
	// The allowed origins of another site, told by their Origin or, without one, by their Referer
	for (const headers of [{ ...SCRIPT, 'sec-fetch-mode': 'cors', origin: EMBED }, { ...SCRIPT, origin: UI }, { ...SCRIPT, referer: `${EMBED}/page` }, { ...SCRIPT, referer: `${preview}/m/@a/b@1.0.0/styles/main?${BROWSER}` }]) {
		assert.equal((await send('GET', MODULE, headers, void 0, 'preview')).status, 200, JSON.stringify(headers));
	}
	// A navigation from anywhere opens what it addresses on the preview origin, which another site cannot read
	const opened = await send('GET', '/preview/index.html', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }, void 0, 'preview');
	assert.equal(opened.status, 200);
	assert.equal(opened.headers['access-control-allow-origin'], undefined);
});

test('behind a public origin a page of the same site is treated as one of another site', async t => {
	const { send, ports } = await compose(t, { pairing: { origins: [UI], embeds: [EMBED], public: 'https://space-{port}.forward.example' } });
	const host = { host: `space-${ports.preview}.forward.example` };
	const sameSite = { ...SCRIPT, ...host, 'sec-fetch-site': 'same-site' };
	assert.deepEqual(code(await send('GET', MODULE, sameSite, void 0, 'preview')), [403, 'SITE_REFUSED'], 'a forwarding domain serves other people\'s ports');
	assert.equal((await send('GET', MODULE, { ...sameSite, origin: EMBED }, void 0, 'preview')).status, 200);
	assert.equal((await send('GET', MODULE, { ...SCRIPT, ...host, 'sec-fetch-site': 'same-origin' }, void 0, 'preview')).status, 200);
});
