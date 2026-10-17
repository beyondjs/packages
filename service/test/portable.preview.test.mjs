/**
 * The port the preview listener asks for (`Service.acquire({preview})`, the command line's `--preview-port`): taken
 * when it is free, another one when something holds it, and the description names the port it took.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Events } from '../host/events.mjs';
import { Hosts } from '../host/hosts.mjs';
import { Portable } from '../host/portable.mjs';
import { Service } from '../service.mjs';
import { CREDENTIAL } from './support/paired.mjs';

const free = () => new Promise((resolve, reject) => {
	const server = createServer().listen(0, '127.0.0.1', () => {
		const { port } = server.address();
		server.close(() => resolve(port));
	}).on('error', reject);
});

async function portable(t) {
	const root = mkdtempSync(join(tmpdir(), 'beyond-preview-port-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const context = { hosts: new Hosts({ bind: '127.0.0.1' }), events: new Events(), session: async () => ({}), environment: {} };
	const listener = new Portable({ root, credential: CREDENTIAL, bind: '127.0.0.1', pairing: { origins: [] } }, context);
	t.after(() => listener.stop());
	return listener;
}

test('the preview listener takes the port it asks for when it is free', async t => {
	const listener = await portable(t);
	const wanted = await free();
	const listening = await listener.listen((request, response) => response.end(), { port: 1, address: '127.0.0.1', preview: wanted });
	assert.equal(listening.port, wanted);
	assert.equal(listening.preview, `http://127.0.0.1:${wanted}`);
});

test('a preview port something else holds gives way to another one, which the description names', async t => {
	const holder = createServer().listen(0, '127.0.0.1');
	await new Promise(resolve => holder.once('listening', resolve));
	t.after(() => holder.close());
	const held = holder.address().port;

	const listener = await portable(t);
	const listening = await listener.listen((request, response) => response.end(), { port: 1, address: '127.0.0.1', preview: held });
	assert.notEqual(listening.port, held);
	assert.equal(listening.preview, `http://127.0.0.1:${listening.port}`);
});

test('acquire refuses a preview port that is not one before starting anything', async () => {
	const service = Object.create(Service.prototype);
	for (const preview of [0, 70000, 1.5, '5300']) {
		await assert.rejects(service.acquire({ lifetime: 'owner', preview }), /preview port/);
	}
});
