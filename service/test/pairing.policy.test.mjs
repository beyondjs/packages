import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Events } from '../host/events.mjs';
import { Hosts } from '../host/hosts.mjs';
import { Portable } from '../host/portable.mjs';
import { conforms } from './support/contract.mjs';
import { BROWSER, compose, CREDENTIAL, EMBED, EVIL, UI } from './support/paired.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };
const MODULE = `/m/@a/b@1.0.0/modules/main?${BROWSER}`;
const code = refused => [refused.status, refused.body?.error?.code];

test('a local tool presents the local credential and reaches everything; a wrong one is refused', async t => {
	const { send, local } = await compose(t);
	assert.equal((await send('GET', '/files/content/.env', local)).body, 'SECRET');
	assert.equal((await send('POST', '/files/operations', { ...local, ...JSON_TYPE }, '{"mutations":[]}')).status, 200);
	assert.equal((await send('POST', '/pairing/codes', local)).status, 201);
	assert.deepEqual(code(await send('GET', '/files/content/.env', { authorization: 'Local not-the-credential' })), [401, 'CREDENTIAL_REQUIRED']);
});

test('a local consumer without the credential reads, and is refused every change and every source', async t => {
	const { send, stream } = await compose(t);
	for (const path of ['/session', MODULE, '/resolution.json', '/preview/index.html']) assert.equal((await send('GET', path)).status, 200, path);
	const events = await stream('/events');
	await events.until('subscribed');
	assert.deepEqual(events.events.map(({ type }) => type), ['build.ended', 'subscribed'], 'build events only');
	events.close();

	for (const [method, path] of [['GET', '/files/content/.env'], ['POST', '/files/operations'], ['POST', '/pairing/codes'], ['GET', '/pairings'], ['GET', '/exports'], ['POST', '/exports'], ['DELETE', '/pairings']]) {
		assert.deepEqual(code(await send(method, path, JSON_TYPE, method === 'POST' ? '{}' : void 0)), [401, 'CREDENTIAL_REQUIRED'], `${method} ${path}`);
	}
});

test('behind a public origin nobody is a local consumer: every request needs the credential or a token', async t => {
	const { send, local, ports, publics } = await compose(t, { pairing: { origins: [UI], public: 'https://space-{port}.forward.example' } });
	assert.equal(publics.api, `https://space-${ports.api}.forward.example`);
	assert.equal(publics.preview, `https://space-${ports.preview}.forward.example`);
	const host = `space-${ports.api}.forward.example`;
	for (const headers of [{}, { host }]) {
		for (const [method, path] of [['GET', '/session'], ['GET', '/files/content/a.ts'], ['GET', '/exports'], ['POST', '/pairing/codes']]) {
			assert.deepEqual(code(await send(method, path, headers)), [401, 'CREDENTIAL_REQUIRED'], `${method} ${path} ${JSON.stringify(headers)}`);
		}
	}
	assert.equal((await send('GET', '/session', { host, ...local })).status, 200, 'the credential through the public host');
	assert.equal((await send('GET', '/preview/index.html', { host: `space-${ports.preview}.forward.example` }, void 0, 'preview')).status, 200);
});

test('a page of another site reads nothing: no source, no session, no compiled module of the API, and no preflight', async t => {
	const { send } = await compose(t);
	for (const path of ['/files/content/.env', '/session', MODULE, '/events']) {
		const refused = await send('GET', path, { origin: EVIL });
		assert.deepEqual(code(refused), [401, 'PAIRING_REQUIRED'], path);
		assert.equal(refused.headers['access-control-allow-origin'], undefined, path);
	}
	const preflight = await send('OPTIONS', '/files/content/a.ts', { origin: EVIL, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization' });
	assert.equal(Object.keys(preflight.headers).filter(name => name.startsWith('access-control-')).length, 0, JSON.stringify(preflight.headers));
});

test('a text body sent to a write route by a page of another site never runs (CSRF)', async t => {
	const { send, writes } = await compose(t);
	const mutations = JSON.stringify({ mutations: [{ operation: 'write', path: 'a.ts', expected: 'absent', content: 'x' }] });
	for (const headers of [{ origin: EVIL }, { origin: UI }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
		for (const path of ['/files/operations', '/exports', '/installation', '/pairing/codes']) {
			const refused = await send('POST', path, { ...headers, 'content-type': 'text/plain;charset=UTF-8' }, mutations);
			assert.equal(refused.status, 401, `${JSON.stringify(headers)} ${path}`);
		}
	}
	assert.deepEqual(writes, [], 'nothing reached the route');
});

test('a name made to resolve to this machine is refused HOST_REFUSED on every route of both listeners', async t => {
	const { send, ports } = await compose(t);
	for (const listener of ['api', 'preview']) {
		const port = ports[listener];
		for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, `localhost:${port}@evil.example`]) {
			for (const [method, path, headers] of [['GET', MODULE], ['GET', '/events'], ['GET', '/preview/'], ['GET', '/session'], ['OPTIONS', '/session', { origin: UI, 'access-control-request-method': 'GET' }]]) {
				const refused = await send(method, path, { ...headers, host }, void 0, listener);
				assert.deepEqual(code(refused), [403, 'HOST_REFUSED'], `${listener} ${method} ${path} ${host}`);
			}
		}
	}
});

test('the preview listener serves previews, browser modules and build events, and nothing else', async t => {
	const { send, stream, local } = await compose(t);
	assert.equal((await send('GET', '/preview/index.html', {}, void 0, 'preview')).status, 200);
	assert.equal((await send('GET', MODULE, {}, void 0, 'preview')).status, 200);
	assert.equal((await send('GET', `/resolution.json?target=browser&format=esm`, {}, void 0, 'preview')).status, 200);
	for (const path of ['/m/@a/b@1.0.0/modules/main?target=node&format=esm', '/u/0123/@a/b@1.0.0/modules/main?target=node', '/m/@a/b@1.0.0/maps/main?target=node', '/resolution.json', '/importmap.json?target=node']) {
		assert.deepEqual(code(await send('GET', path, {}, void 0, 'preview')), [403, 'TARGET_REFUSED'], path);
	}
	// Stylesheets and declared assets are the same for every target; a module address without one reaches its route
	for (const path of ['/m/@a/b@1.0.0/assets/main/logo.svg', '/m/@a/b@1.0.0/styles/main?target=node&format=esm', '/u/0123/@a/b@1.0.0/styles/main?target=node', '/m/@a/b@1.0.0/modules/main']) {
		assert.equal((await send('GET', path, {}, void 0, 'preview')).status, 200, path);
	}
	for (const [method, path] of [['GET', '/files/content/x'], ['GET', '/session'], ['GET', '/state'], ['POST', '/pairing'], ['POST', '/pairing/codes'], ['GET', '/ui/'], ['GET', '/exports'], ['POST', '/files/operations']]) {
		assert.deepEqual(code(await send(method, path, { ...local, ...JSON_TYPE }, method === 'POST' ? '{}' : void 0, 'preview')), [404, 'NOT_FOUND'], `${method} ${path}`);
	}
	const events = await stream('/events', { ...local }, 'preview');
	await events.until('subscribed');
	assert.deepEqual(events.events.map(({ type }) => type), ['build.ended', 'subscribed'], 'even a local tool reads build events only there');
});

test('compiled modules are read across origins by allowed origins only, never with "*"', async t => {
	const { send, preview, pair } = await compose(t);
	for (const origin of [EMBED, UI, preview]) {
		const allowed = await send('GET', MODULE, { origin }, void 0, 'preview');
		assert.equal(allowed.headers['access-control-allow-origin'], origin, origin);
		assert.match(allowed.headers.vary, /Origin/);
		assert.match(allowed.headers['access-control-expose-headers'], /etag/);
	}
	const foreign = await send('GET', MODULE, { origin: EVIL }, void 0, 'preview');
	assert.equal(foreign.status, 200, 'a module script of any page still loads');
	assert.equal(foreign.headers['access-control-allow-origin'], undefined, 'but no page of another site reads it');

	const { token } = await pair();
	const read = await send('GET', MODULE, { origin: UI, authorization: `Bearer ${token}` });
	assert.equal(read.headers['access-control-allow-origin'], UI, 'the API answers its paired interface');
	assert.equal((await send('GET', MODULE, { origin: EMBED })).headers['access-control-allow-origin'], undefined, 'an embed reads the preview listener only');
});

test('the preview origin never pairs', async t => {
	const { send, preview, local } = await compose(t);
	const { body: created } = await send('POST', '/pairing/codes', local);
	const refused = await send('POST', '/pairing', { origin: preview, ...JSON_TYPE }, JSON.stringify({ code: created.code }));
	assert.deepEqual(code(refused), [403, 'PAIRING_ORIGIN']);
	const named = await send('POST', '/pairing/codes', { ...local, ...JSON_TYPE }, JSON.stringify({ origins: [preview] }));
	assert.deepEqual(code(named), [400, 'PAIRING_ORIGINS_INVALID']);
	const preflight = await send('OPTIONS', '/pairing', { origin: preview, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' });
	assert.equal(preflight.headers['access-control-allow-origin'], undefined);
	assert.equal((await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, JSON.stringify({ code: created.code }))).status, 201, 'the code was not spent');
});

test('a page pairs with a code from an allowed origin, then reaches everything, and its token works from that origin only', async t => {
	const { send, local, api, attach } = await compose(t);
	const announced = await attach();
	const { body: created } = await send('POST', '/pairing/codes', local);
	assert.ok(created.origins.includes(UI) && created.origins.includes(api), JSON.stringify(created.origins));
	assert.ok(conforms('code', created).valid, conforms('code', created).errors);
	const paired = await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, JSON.stringify({ code: created.code }));
	assert.equal(paired.status, 201);
	assert.ok(conforms('paired', paired.body).valid, conforms('paired', paired.body).errors);
	const listed = (await send('GET', '/pairings', local)).body;
	assert.ok(conforms('pairings', listed).valid, conforms('pairings', listed).errors);
	assert.equal(paired.headers['access-control-allow-origin'], UI);
	const { token, pairing, session } = paired.body;
	assert.match(token, /^[A-Za-z0-9_-]{43}$/);
	assert.deepEqual(Object.keys(pairing).sort(), ['created', 'id', 'origin']);
	assert.equal(session.protocol, 'beyond-dev-session/1');
	assert.deepEqual((await announced.until('paired')).data, { id: pairing.id, origin: UI }, 'the command line is told, with the origin');

	const headers = { origin: UI, authorization: `Bearer ${token}` };
	assert.equal((await send('GET', '/files/content/.env', headers)).body, 'SECRET');
	assert.equal((await send('POST', '/files/operations', { ...headers, ...JSON_TYPE }, '{"mutations":[]}')).status, 200);
	assert.deepEqual(code(await send('GET', '/session', { origin: EVIL, authorization: `Bearer ${token}` })), [403, 'PAIRING_ORIGIN']);
	for (const [method, path] of [['POST', '/pairing/codes'], ['GET', '/pairings'], ['DELETE', '/pairings']]) {
		assert.deepEqual(code(await send(method, path, { ...headers, ...JSON_TYPE }, method === 'POST' ? '{}' : void 0)), [401, 'CREDENTIAL_REQUIRED'], `${method} ${path}`);
	}
});

test('the interface the service serves pairs from the API origin, whose own requests carry no Origin', async t => {
	const { send, api, pair } = await compose(t);
	const { token } = await pair(api);
	assert.equal((await send('GET', '/session', { 'sec-fetch-site': 'same-origin', authorization: `Bearer ${token}` })).status, 200);
	assert.equal((await send('GET', '/ui/', { 'sec-fetch-site': 'none' })).status, 404, 'reached: no interface build in this case');
});

test('pairing refuses a page of another origin and a text body, and five wrong codes end the outstanding ones', async t => {
	const { send, local } = await compose(t);
	const { body: created } = await send('POST', '/pairing/codes', local);
	assert.deepEqual(code(await send('POST', '/pairing', { origin: EVIL, ...JSON_TYPE }, JSON.stringify({ code: created.code }))), [403, 'PAIRING_ORIGIN']);
	assert.deepEqual(code(await send('POST', '/pairing', { origin: UI, 'content-type': 'text/plain' }, JSON.stringify({ code: created.code }))), [415, 'CONTENT_TYPE_UNSUPPORTED']);
	const statuses = [];
	for (let attempt = 0; attempt < 5; attempt++) statuses.push((await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, '{"code":"ZZZZ-ZZZZ"}')).status);
	assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
	assert.deepEqual(code(await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, JSON.stringify({ code: created.code }))), [429, 'PAIRING_ATTEMPTS']);
});

test('the preflight of an allowed origin is answered with its methods, headers, age and private network access', async t => {
	const { send } = await compose(t);
	const asked = { origin: UI, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, if-match', 'access-control-request-private-network': 'true' };
	const preflight = await send('OPTIONS', '/files/content/a.ts', asked);
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers['access-control-allow-origin'], UI);
	assert.equal(preflight.headers['access-control-allow-methods'], 'GET, PUT, POST, DELETE');
	assert.equal(preflight.headers['access-control-allow-headers'], 'authorization, content-type, if-match, if-none-match, last-event-id, idempotency-key');
	assert.equal(preflight.headers['access-control-max-age'], '600');
	assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
	assert.match(preflight.headers.vary, /Origin/);
	assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
	const plain = await send('OPTIONS', '/session', { origin: UI, 'access-control-request-method': 'GET' });
	assert.equal(plain.headers['access-control-allow-private-network'], undefined, 'only when the browser asks for it');
});

test('a revoked or expired pairing ends the stream it opened, and a page ends its own pairing', async t => {
	const { send, stream, pair, local } = await compose(t, { environment: { BEYOND_PAIRING_TTL: '600' } });
	const first = await pair();
	const events = await stream('/events', { origin: UI, authorization: `Bearer ${first.token}` });
	await events.until('subscribed');
	assert.deepEqual(events.events.map(({ type }) => type), ['file.changed', 'build.ended', 'export.changed', 'subscribed'], 'a paired page receives every event');
	assert.equal((await send('DELETE', `/pairings/${first.pairing.id}`, local)).status, 204);
	assert.equal((await events.until('access.ended')).data.reason, 'PAIRING_REVOKED');
	assert.deepEqual(code(await send('GET', '/session', { origin: UI, authorization: `Bearer ${first.token}` })), [401, 'PAIRING_REVOKED']);

	const second = await pair();
	const expiring = await stream('/events', { origin: UI, authorization: `Bearer ${second.token}` });
	assert.equal((await expiring.until('access.ended')).data.reason, 'PAIRING_EXPIRED');

	const third = await pair();
	const leaving = { origin: UI, authorization: `Bearer ${third.token}` };
	assert.equal((await send('DELETE', '/pairing', leaving)).status, 204);
	assert.deepEqual(code(await send('GET', '/session', leaving)), [401, 'PAIRING_REVOKED']);
});

test('a service that pairs listens on a loopback address unless it is given its public origin, and never with delegated access', () => {
	const context = { hosts: new Hosts({ bind: '0.0.0.0' }), events: new Events(), session: async () => ({}), environment: {} };
	const settings = { root: '/w', credential: CREDENTIAL, bind: '0.0.0.0', pairing: { origins: [] } };
	assert.throws(() => new Portable(settings, context), /listens on a loopback address unless it is given its public origin/);
	assert.doesNotThrow(() => new Portable({ ...settings, pairing: { origins: [], public: 'https://space-{port}.forward.example' } }, context));
	assert.throws(() => new Portable({ ...settings, bind: '127.0.0.1' }, { ...context, environment: { BEYOND_AUTHORITY: '{}' } }), /delegated grants/);
	assert.throws(() => new Portable({ ...settings, bind: '127.0.0.1', credential: void 0 }, context), /local credential/);
	assert.throws(() => new Portable({ ...settings, bind: '127.0.0.1', pairing: { public: 'http://space.example' } }, context), /https origin/);
});
