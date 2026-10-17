import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, EVIL, UI } from './support/paired.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };
const code = ({ status, body }) => [status, body?.error?.code];

test('a code comes with the fragment a command line appends to an interface link', async t => {
	const { send, local } = await compose(t);
	const { status, body } = await send('POST', '/pairing/codes', local);
	assert.equal(status, 201);
	assert.equal(body.fragment, `code=${body.code}`);
});

test('a page without a token learns what the service implements and that it is not paired, and nothing of the workspace', async t => {
	const { send } = await compose(t);
	const probe = await send('GET', '/session', { origin: UI });
	assert.equal(probe.status, 200);
	assert.deepEqual(probe.body, { protocol: 'beyond-dev-session/1', capabilities: { pairing: 1, exports: 1 }, pairing: null });
	assert.equal(probe.headers['access-control-allow-origin'], UI);
	assert.equal(probe.headers['cache-control'], 'no-store');

	assert.deepEqual(code(await send('GET', '/session', { origin: EVIL })), [401, 'PAIRING_REQUIRED'], 'another site is refused');
	assert.deepEqual(code(await send('GET', '/session', { origin: UI, authorization: `Bearer ${'A'.repeat(43)}` })), [401, 'PAIRING_REQUIRED'], 'a token is checked');
	assert.deepEqual(code(await send('GET', '/session', { origin: UI, authorization: 'Local wrong' })), [401, 'PAIRING_REQUIRED'], 'a browser never presents the credential');
	assert.deepEqual(code(await send('POST', '/session', { origin: UI })), [401, 'PAIRING_REQUIRED'], 'reads only');
});

test('an ended pairing is still answered with its reason, so a page knows to pair again', async t => {
	const { send, pair, local } = await compose(t);
	const { token } = await pair();
	await send('DELETE', '/pairings', local);
	assert.deepEqual(code(await send('GET', '/session', { origin: UI, authorization: `Bearer ${token}` })), [401, 'PAIRING_REVOKED']);
});

test('a paired page reads its own pairing and the Snapshots origins it may upload to in its session', async t => {
	const { send, pair } = await compose(t);
	const { token, pairing } = await pair();
	const { status, body } = await send('GET', '/session', { origin: UI, authorization: `Bearer ${token}` });
	assert.equal(status, 200);
	assert.equal(body.workspace.root !== undefined, true, 'the whole session');
	assert.deepEqual(Object.keys(body.pairing).sort(), ['created', 'expires', 'id', 'origin']);
	assert.deepEqual([body.pairing.id, body.pairing.origin], [pairing.id, UI]);
	assert.deepEqual(body.exports, { destinations: ['https://snapshots.beyondjs.com'] });
});

test('a page declares its Snapshots origin when it pairs or later, for its own pairing only', async t => {
	const settings = { value: key => (key === 'snapshots.origins' ? ['https://configured.example'] : void 0) };
	const { send, local } = await compose(t, { environment: { BEYOND_SNAPSHOTS_ORIGINS: 'https://started.example' }, services: { get: name => (name === 'settings' ? settings : void 0) } });
	const created = (await send('POST', '/pairing/codes', local)).body;

	const invalid = await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, JSON.stringify({ code: created.code, snapshots: 'http://snapshots.example.com' }));
	assert.deepEqual(code(invalid), [400, 'PAIRING_DESTINATION_INVALID']);
	const paired = await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, JSON.stringify({ code: created.code, snapshots: 'http://snapshots.beyond.localhost:5300' }));
	assert.equal(paired.status, 201, 'the code was not used by the refused declaration');
	const bearer = { origin: UI, authorization: `Bearer ${paired.body.token}` };
	const read = async headers => (await send('GET', '/session', headers)).body.exports.destinations;
	assert.deepEqual(await read(bearer), ['https://started.example', 'https://snapshots.beyondjs.com', 'http://snapshots.beyond.localhost:5300', 'https://configured.example']);

	for (const snapshots of ['https://snapshots.example.com/v1', 'https://snapshots.example.com?x=1', 'ftp://snapshots.example.com', 'https://user:secret@snapshots.example.com', 'http://snapshots.example.com', null, 7]) {
		assert.deepEqual(code(await send('PUT', '/pairing', { ...bearer, ...JSON_TYPE }, JSON.stringify({ snapshots }))), [400, 'PAIRING_DESTINATION_INVALID'], String(snapshots));
	}
	const declared = await send('PUT', '/pairing', { ...bearer, ...JSON_TYPE }, JSON.stringify({ snapshots: 'https://snapshots.example.com' }));
	assert.equal(declared.status, 204);
	assert.ok((await read(bearer)).includes('https://snapshots.example.com'));
	assert.equal((await send('GET', '/pairings', local)).body.pairings[0].snapshots, 'https://snapshots.example.com');

	const other = (await send('POST', '/pairing', { origin: UI, ...JSON_TYPE }, JSON.stringify({ code: (await send('POST', '/pairing/codes', local)).body.code }))).body;
	assert.equal((await read({ origin: UI, authorization: `Bearer ${other.token}` })).includes('https://snapshots.example.com'), false, 'not for another pairing');
	assert.equal((await read(local)).includes('https://snapshots.example.com'), false, 'nor for a local tool');

	assert.deepEqual(code(await send('PUT', '/pairing', { ...local, ...JSON_TYPE }, JSON.stringify({ snapshots: 'https://snapshots.example.com' }))), [404, 'PAIRING_NOT_FOUND']);
	assert.deepEqual(code(await send('PUT', '/pairing', { ...bearer, 'content-type': 'text/plain' }, JSON.stringify({ snapshots: 'https://snapshots.example.com' }))), [415, 'CONTENT_TYPE_UNSUPPORTED']);
});
