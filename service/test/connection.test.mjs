import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Connection, TimeoutError } from '../connection.mjs';
import { StallingServer } from './support/stalling.mjs';

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

/**
 * Sets an environment variable for the rest of a case
 */
const environment = (t, name, value) => {
	const previous = process.env[name];
	process.env[name] = value;
	t.after(() => (previous === void 0 ? delete process.env[name] : (process.env[name] = previous)));
};

const stalling = async (t, mode, options) => {
	const server = await new StallingServer(mode, options).listen();
	t.after(() => server.close());
	return server;
};

const failed = promise =>
	promise.then(
		value => assert.fail(`expected a failure, got ${JSON.stringify(value)}`),
		error => error
	);

test('the environment names how long a selection or a state is waited for', () => {
	assert.equal(Connection.limit({}), Connection.REQUEST);
	assert.equal(Connection.limit({ BEYOND_REQUEST_TIMEOUT: '600000' }), 600000);
	assert.throws(() => Connection.limit({ BEYOND_REQUEST_TIMEOUT: '-1' }), /BEYOND_REQUEST_TIMEOUT must be a whole number of milliseconds/);
});

test('a state the service never answers is reported as a service that does not answer, naming its bound', async t => {
	const server = await stalling(t, 'silent');
	environment(t, 'BEYOND_REQUEST_TIMEOUT', '150');

	const failure = await failed(new Connection(server.origin).state());
	assert.ok(failure instanceof TimeoutError, `expected a TimeoutError, got ${failure}`);
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.equal(failure.path, '/state');
	assert.match(failure.message, /did not answer GET \/state within 150ms/);
	assert.match(failure.message, /BEYOND_REQUEST_TIMEOUT/);
});

test('a selection whose body never arrives is bounded as well as its headers', async t => {
	const server = await stalling(t, 'headers');
	environment(t, 'BEYOND_REQUEST_TIMEOUT', '150');

	const failure = await failed(new Connection(server.origin).selection('@example/app/main', '/ws'));
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.equal(failure.path, '/selection', 'the query, which names local paths, is not repeated');
});

test('a service that answers it cannot answer now is reported as unavailable, not as a timeout', async t => {
	const server = await stalling(t, 'unavailable');

	const failure = await failed(new Connection(server.origin).state());
	assert.equal(failure.name, 'ContractError');
	assert.equal(failure.code, 'UNAVAILABLE');
	assert.equal(failure.status, 503);
});

test('an attachment the service never answers fails within the bound of a first answer', async t => {
	const server = await stalling(t, 'silent');
	environment(t, 'BEYOND_SESSION_TIMEOUT', '150');

	const failure = await failed(new Connection(server.origin).attach('session', { stopping: () => assert.fail('never attached') }));
	assert.ok(failure instanceof TimeoutError, `expected a TimeoutError, got ${failure}`);
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.match(failure.message, /did not answer GET \/attach within 150ms/);
});

test('an attached service that stops sending its heartbeat is treated as ended', async t => {
	const server = await stalling(t, 'attached', { heartbeat: 40 });

	let resolve;
	const stopped = new Promise(done => (resolve = done));
	const attachment = await new Connection(server.origin).attach('session', { stopping: resolve });
	t.after(() => attachment.detach());

	assert.equal(await stopped, 'the service stopped answering');
});

test('an attached service that keeps its heartbeat is not treated as ended', async t => {
	// Five heartbeats last longer than the silence that ends an attachment: they must keep it
	const server = await stalling(t, 'attached', { heartbeat: 40, beats: 5 });
	const beaten = new Promise(resolve => server.on('beat', count => count === 5 && resolve()));

	let reason;
	const attachment = await new Connection(server.origin).attach('session', { stopping: value => (reason = value) });
	t.after(() => attachment.detach());

	await beaten;
	assert.equal(reason, undefined);
});
