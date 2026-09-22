import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Connection, TimeoutError } from '../connection.mjs';

test('the environment names how long the first description of a service is waited for', () => {
	assert.equal(Connection.deadline({}), Connection.TIMEOUT);
	assert.equal(Connection.deadline({ BEYOND_SESSION_TIMEOUT: '' }), Connection.TIMEOUT);
	assert.equal(Connection.deadline({ BEYOND_SESSION_TIMEOUT: '60000' }), 60000);
	assert.throws(() => Connection.deadline({ BEYOND_SESSION_TIMEOUT: '0' }), /whole number of milliseconds/);
	assert.throws(() => Connection.deadline({ BEYOND_SESSION_TIMEOUT: 'soon' }), /whole number of milliseconds/);
});

test('a service that answers too late is reported as slow, not as somebody else', async t => {
	// A service that is there and never answers: the deadline decides, and the record must survive it
	const server = createServer(() => void 0);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());

	const origin = `http://127.0.0.1:${server.address().port}`;
	const previous = process.env.BEYOND_SESSION_TIMEOUT;
	process.env.BEYOND_SESSION_TIMEOUT = '150';
	t.after(() => {
		previous === void 0 ? delete process.env.BEYOND_SESSION_TIMEOUT : (process.env.BEYOND_SESSION_TIMEOUT = previous);
	});

	const failure = await Connection.validate({ origin }, { root: '/ws', toolchain: 'x' }).then(
		value => value,
		error => error
	);
	assert.ok(failure instanceof TimeoutError, `expected a TimeoutError, got ${failure}`);
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.match(failure.message, /did not describe itself within 150ms/);
	assert.match(failure.message, /BEYOND_SESSION_TIMEOUT/);
});

test('nothing answering at the address is a stale record, not a slow service', async () => {
	// A port nothing listens on refuses the connection at once, which is what a stale record looks like
	const server = createServer(() => void 0);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	await new Promise(resolve => server.close(resolve));

	const validated = await Connection.validate({ origin: `http://127.0.0.1:${port}` }, { root: '/ws', toolchain: 'x' });
	assert.equal(validated, undefined);
});
