import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import express from 'express';
import { Exports } from '../host/exports/exports.mjs';
import { ExportRoutes } from '../host/exports/routes.mjs';
import { conforms } from './support/contract.mjs';
import { workspace } from './support/exports.mjs';
import { stand } from './support/snapshots.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };

/**
 * The export routes mounted alone over a copy of the fixture, as the host mounts them on a service that pairs (the
 * policy in front of them is exercised by pairing.policy.test.mjs)
 */
const mount = async (t, environment = {}) => {
	const root = workspace(t, { additions: false });
	const exports = new Exports(root, { environment });
	await exports.start();
	const app = express();
	new ExportRoutes(exports).setup(app);
	app.use((error, request, response, next) => response.status(500).json({ error: { code: 'INTERNAL', message: error.message } }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		exports.stop();
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	const { port } = server.address();
	const send = (method, path, headers = {}, body) =>
		new Promise((resolve, reject) => {
			const sent = request({ host: '127.0.0.1', port, path, method, headers }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => (text += chunk));
				response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : void 0 }));
			});
			sent.on('error', reject);
			sent.end(body);
		});
	return { send, root };
};

test('an export is created, listed, read and removed, every answer no-store', async t => {
	const { send } = await mount(t);
	const created = await send('POST', '/exports', JSON_TYPE, JSON.stringify({ packages: ['packages/plain'] }));
	assert.equal(created.status, 201);
	assert.equal(created.headers['cache-control'], 'no-store');
	const { export: record } = created.body;
	assert.match(record.id, /^exp_[0-9a-f]{32}$/);
	assert.equal(record.protocol, 'beyond-dev-exports/1');
	assert.equal(record.state, 'ready');
	const conformance = conforms('export', record);
	assert.ok(conformance.valid, conformance.errors);

	assert.deepEqual((await send('GET', '/exports')).body.exports.map(({ id }) => id), [record.id]);
	assert.equal((await send('GET', `/exports/${record.id}`)).body.export.packages[0].digest, record.packages[0].digest);
	assert.equal((await send('DELETE', `/exports/${record.id}`)).status, 204);
	const missing = await send('GET', `/exports/${record.id}`);
	assert.deepEqual([missing.status, missing.body.error.code], [404, 'EXPORT_NOT_FOUND']);
	assert.equal((await send('DELETE', `/exports/${record.id}`)).status, 404);
	assert.equal((await send('GET', '/exports/..%2F..%2Fpackage.json')).status, 404, 'an identifier never reaches outside the exports');
});

test('a body that is not JSON, or names an invalid package, is refused before anything is written', async t => {
	const { send } = await mount(t);
	const text = await send('POST', '/exports', { 'content-type': 'text/plain' }, '{"packages":["."]}');
	assert.deepEqual([text.status, text.body.error.code], [415, 'CONTENT_TYPE_UNSUPPORTED']);
	const malformed = await send('POST', '/exports', JSON_TYPE, '{"packages":');
	assert.deepEqual([malformed.status, malformed.body.error.code], [400, 'BODY_INVALID']);
	const invalid = await send('POST', '/exports', JSON_TYPE, JSON.stringify({ packages: ['../elsewhere'] }));
	assert.deepEqual([invalid.status, invalid.body.error.code], [400, 'EXPORT_PACKAGE_INVALID']);
	const large = await send('POST', '/exports', JSON_TYPE, JSON.stringify({ packages: ['x'.repeat(70000)] }));
	assert.deepEqual([large.status, large.body.error.code], [413, 'BODY_TOO_LARGE']);
	assert.deepEqual((await send('GET', '/exports')).body.exports, []);
});

test('a transfer is accepted with 202 and refused with its code', async t => {
	const snapshots = await stand(t);
	const { send } = await mount(t, { BEYOND_SNAPSHOTS_ORIGINS: snapshots.origin });
	const { body } = await send('POST', '/exports', JSON_TYPE, JSON.stringify({ packages: ['packages/plain'] }));
	const id = body.export.id;
	const capture = 'snp_0123456789abcdef0123456789abcdef';

	const outside = await send('POST', `/exports/${id}/transfer`, JSON_TYPE, JSON.stringify({ capture: { id: capture }, grants: [{ path: 'packages/plain', upload: 'https://elsewhere.example/upload', token: 't' }] }));
	assert.deepEqual([outside.status, outside.body.error.code], [403, 'EXPORT_DESTINATION']);
	const text = await send('POST', `/exports/${id}/transfer`, { 'content-type': 'text/plain' }, '{}');
	assert.equal(text.status, 415);

	const accepted = await send('POST', `/exports/${id}/transfer`, JSON_TYPE, JSON.stringify({ capture: { id: capture }, grants: snapshots.grants(capture, ['packages/plain']) }));
	assert.equal(accepted.status, 202);
	assert.equal(accepted.body.export.transfer.packages[0].state, 'queued');
	assert.equal(JSON.stringify(accepted.body).includes('grant-'), false, 'the answer never repeats a grant');

	const deadline = Date.now() + 5000;
	let state;
	let latest;
	while (state !== 'stored' && Date.now() < deadline) {
		latest = (await send('GET', `/exports/${id}`)).body.export;
		state = latest.transfer.packages[0].state;
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	assert.equal(state, 'stored');
	const conformance = conforms('export', latest);
	assert.ok(conformance.valid, conformance.errors);
	assert.ok(conforms('transfer', { capture: { id: capture }, grants: snapshots.grants(capture, ['packages/plain']) }).valid, 'the grants the stand-in gives are the contract\'s');
});
