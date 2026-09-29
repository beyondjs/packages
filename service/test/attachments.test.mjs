import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import express from 'express';
import { Attachments } from '../host/attachments.mjs';
import { Connection } from '../connection.mjs';

/**
 * The attachment stream of a host, mounted alone on an ephemeral loopback port
 */
const host = async (t, options) => {
	const attachments = new Attachments('token', options);
	const app = express();
	attachments.setup(app);
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		attachments.close('the case ended');
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	return { attachments, origin: `http://127.0.0.1:${server.address().port}` };
};

test('the attachment stream announces its heartbeat and keeps sending it', async t => {
	const { origin } = await host(t, { heartbeat: 30 });

	const received = await new Promise((resolve, reject) => {
		let text = '';
		const request = get(`${origin}/attach?kind=session`, response => {
			response.setEncoding('utf8');
			response.on('data', chunk => {
				text += chunk;
				if (text.split(': heartbeat\n\n').length > 2) {
					request.destroy();
					resolve(text);
				}
			});
		});
		request.on('error', reject);
	});

	const attached = JSON.parse(/event: attached\ndata: (.*)\n/.exec(received)[1]);
	assert.equal(attached.heartbeat, 30);
	assert.equal(attached.kind, 'session');
});

/**
 * Resolves once a raw client of the stream has received the given number of heartbeats
 */
const heartbeats = (t, origin, count) =>
	new Promise((resolve, reject) => {
		let text = '';
		const request = get(`${origin}/attach?kind=consumer`, response => {
			response.setEncoding('utf8');
			response.on('data', chunk => {
				text += chunk;
				if (text.split(': heartbeat\n\n').length > count) resolve();
			});
		});
		request.on('error', reject);
		t.after(() => request.destroy());
	});

test('a client of the heartbeat stays attached while the service is alive, and is told when it stops', async t => {
	const { attachments, origin } = await host(t, { heartbeat: 30 });

	let reason;
	const stopped = new Promise(resolve => (reason = resolve));
	await new Connection(origin).attach('session', { stopping: reason });

	// Five heartbeats last twice the silence that ends an attachment, and the client is still attached
	await heartbeats(t, origin, 5);
	assert.deepEqual(
		attachments.list.map(({ kind }) => kind).sort(),
		['consumer', 'session']
	);

	attachments.close('the case stopped the service');
	assert.equal(await stopped, 'the case stopped the service');
});
