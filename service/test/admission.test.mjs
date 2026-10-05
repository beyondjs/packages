import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stand } from './support/installation.mjs';
import { mount } from './support/routes.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };

/**
 * The routes over a stand whose installations answer at once; `options` as `mount` takes them
 */
const routes = (t, options) => {
	const stand = new Stand({ projection: 'missing' });
	return mount(t, stand, options).then(mounted => ({ ...mounted, stand }));
};

test('a request to install whose body is not sent as JSON is refused before anything runs', async t => {
	const { send, port, stand } = await routes(t);
	const host = `127.0.0.1:${port}`;

	// What a page of any site can send without asking first: a text body, or no body at all
	const text = await send('POST', { host, 'content-type': 'text/plain;charset=UTF-8', origin: 'https://site.example' }, '{"update":true}');
	assert.equal(text.status, 415);
	assert.equal(text.body.error.code, 'CONTENT_TYPE_UNSUPPORTED');
	const empty = await send('POST', { host });
	assert.equal(empty.status, 415);
	assert.match(empty.body.error.message, /sent without one/);

	assert.equal(stand.installations.length, 0, 'nothing was installed');
	assert.equal((await send('POST', { host, 'content-type': 'application/json; charset=utf-8' }, '{}')).status, 200);
});

test('a request to install from a page of another origin is refused, and one of the service itself is not', async t => {
	const { send, port, stand } = await routes(t);
	const host = `127.0.0.1:${port}`;

	for (const origin of ['https://site.example', 'null', `http://127.0.0.1:${port + 1}`, `http://localhost:${port}`]) {
		const refused = await send('POST', { host, origin, ...JSON_TYPE }, '{"update":true}');
		assert.equal(refused.status, 403, origin);
		assert.equal(refused.body.error.code, 'ORIGIN_REFUSED', origin);
	}
	assert.equal(stand.installations.length, 0);

	assert.equal((await send('POST', { host, origin: `http://${host}`, ...JSON_TYPE }, '{}')).status, 200, 'its own origin');
	assert.equal((await send('POST', { host, ...JSON_TYPE }, '{}')).status, 200, 'a command line sends no origin');
	assert.equal(stand.installations.length, 2);
});

test('on the loopback address a request to install must name a loopback host with the service\'s port', async t => {
	const { send, port, stand } = await routes(t);

	// What a site whose name was made to resolve to this machine sends: its own name, as host and origin
	for (const host of [`site.example:${port}`, `127.0.0.1:${port + 1}`, `localhost:${port}@site.example`]) {
		const refused = await send('POST', { host, origin: `http://${host}`, ...JSON_TYPE }, '{}');
		assert.equal(refused.status, 403, host);
		assert.equal(refused.body.error.code, 'HOST_REFUSED', host);
	}
	assert.equal(stand.installations.length, 0);

	for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`]) {
		assert.equal((await send('POST', { host, ...JSON_TYPE }, '{}')).status, 200, host);
	}
});

test('behind another address the host is not checked, and a page of another origin still is', async t => {
	const { send, stand } = await routes(t, { bind: '0.0.0.0' });
	const host = 'environment.example.test';

	assert.equal((await send('POST', { host, ...JSON_TYPE }, '{}')).status, 200, 'a gateway decides who reaches the service');
	assert.equal((await send('POST', { host, origin: `https://${host}`, ...JSON_TYPE }, '{}')).status, 200, 'its own page, through TLS');
	const refused = await send('POST', { host, origin: 'https://site.example', ...JSON_TYPE }, '{}');
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.code, 'ORIGIN_REFUSED');
	assert.equal(stand.installations.length, 2);
});

test('no answer about the installation can be read by a page of another origin, its preflight included', async t => {
	const { send, port } = await routes(t);
	const host = `127.0.0.1:${port}`;
	const origin = 'https://site.example';

	const answers = [
		await send('GET', { host, origin }),
		await send('POST', { host, ...JSON_TYPE }, '{}'),
		await send('POST', { host, ...JSON_TYPE }, '{"update":"yes"}'),
		await send('POST', { host, origin, ...JSON_TYPE }, '{}'),
		await send('POST', { host, 'content-type': 'text/plain' }, '{}')
	];
	assert.deepEqual(answers.map(({ status }) => status), [200, 200, 400, 403, 415]);
	answers.forEach(({ headers }) => assert.equal(headers['access-control-allow-origin'], undefined));

	const preflight = await send('OPTIONS', { host, origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' });
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers['access-control-allow-origin'], undefined, 'so a browser never sends the request');
	assert.equal(preflight.headers.allow, 'GET, POST');
});
