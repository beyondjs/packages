import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairingClient } from '../pairing.mjs';
import { compose, UI } from './support/paired.mjs';
import { StallingServer } from './support/stalling.mjs';

test('a local tool creates codes, lists the pairings and revokes them, with the local credential', async t => {
	const { api, send, local } = await compose(t);
	await assert.rejects(new PairingClient(api).code(), error => error.code === 'CREDENTIAL_REQUIRED' && error.status === 401, 'never without it');
	const client = new PairingClient(api, local);
	const { code, expires, origins } = await client.code({ origins: ['https://other.example'] });
	assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
	assert.ok(Date.parse(expires) > Date.now());
	assert.ok(origins.includes(UI) && origins.includes('https://other.example'));

	const paired = await send('POST', '/pairing', { origin: UI, 'content-type': 'application/json' }, JSON.stringify({ code }));
	const [listed] = await client.list();
	assert.deepEqual([listed.id, listed.origin], [paired.body.pairing.id, UI]);

	await client.revoke(listed.id);
	assert.deepEqual(await client.list(), []);
	await assert.rejects(client.revoke(listed.id), error => error.name === 'ContractError' && error.code === 'PAIRING_NOT_FOUND' && error.status === 404);
	await client.revoke();
});

test('a service that does not pair browsers has no pairing routes', async t => {
	const { api } = await compose(t, { pairing: false });
	await assert.rejects(new PairingClient(api).code(), error => error.name === 'ContractError' && error.code === 'NOT_FOUND');
});

test('a service that does not answer is reported within BEYOND_SESSION_TIMEOUT, never waited for', async t => {
	const server = await new StallingServer('silent').listen();
	t.after(() => server.close());
	const previous = process.env.BEYOND_SESSION_TIMEOUT;
	process.env.BEYOND_SESSION_TIMEOUT = '150';
	t.after(() => (previous === void 0 ? delete process.env.BEYOND_SESSION_TIMEOUT : (process.env.BEYOND_SESSION_TIMEOUT = previous)));

	const started = Date.now();
	await assert.rejects(new PairingClient(server.origin).code(), error => error.code === 'SERVICE_NOT_ANSWERING' && /POST \/pairing\/codes within 150ms/.test(error.message));
	assert.ok(Date.now() - started < 3000);
});
