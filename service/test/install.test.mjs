import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AbortError, Connection, TimeoutError } from '../connection.mjs';
import { AnsweringServer } from './support/answering.mjs';
import { StallingServer } from './support/stalling.mjs';

/**
 * Sets an environment variable for the rest of a case
 */
const environment = (t, name, value) => {
	const previous = process.env[name];
	process.env[name] = value;
	t.after(() => (previous === void 0 ? delete process.env[name] : (process.env[name] = previous)));
};

const answering = async (t, routes) => {
	const server = await new AnsweringServer(routes).listen();
	t.after(() => server.close());
	return server;
};

const failed = promise =>
	promise.then(
		value => assert.fail(`expected a failure, got ${JSON.stringify(value)}`),
		error => error
	);

const REPORT = {
	protocol: 'beyond-installation/1',
	valid: true,
	frozen: false,
	lock: { path: '/ws/beyond-lock.json', digest: 'sha256-lock', written: true },
	execution: { path: '/ws/.beyond/execution.json', written: true },
	counts: { members: 2, nodes: 3, fetched: 1, reused: 0 },
	diagnostics: []
};

test('the environment names how long an installation is waited for', () => {
	assert.equal(Connection.allowance({}), Connection.INSTALL);
	assert.equal(Connection.INSTALL, 900000, 'above the queue wait, the installation and the reload of the service (780 s)');
	assert.equal(Connection.allowance({ BEYOND_INSTALL_TIMEOUT: '900000' }), 900000);
	assert.throws(() => Connection.allowance({ BEYOND_INSTALL_TIMEOUT: 'ten minutes' }), /BEYOND_INSTALL_TIMEOUT must be a whole number of milliseconds/);
});

test('the installation state is read with a GET, and its answer is returned as the service gave it', async t => {
	const state = { state: 'missing', diagnostics: [{ code: 'EXECUTION_GRAPH_MISSING', message: 'not installed', severity: 'error' }] };
	const server = await answering(t, { 'GET /installation': { status: 200, body: state } });

	assert.deepEqual(await new Connection(server.origin).installation(), state);
	assert.deepEqual(server.requests.map(({ method, path }) => [method, path]), [['GET', '/installation']]);
});

test('an installation is a POST of the options that were given, answered with its report', async t => {
	const server = await answering(t, { 'POST /installation': { status: 200, body: REPORT } });
	const connection = new Connection(server.origin);

	assert.deepEqual(await connection.install({ update: true }), REPORT);
	assert.deepEqual(await connection.install(), REPORT);
	assert.deepEqual(await connection.install({ update: false, offline: true }), REPORT);

	assert.deepEqual(
		server.requests.map(({ method, type, body }) => [method, type, body]),
		[
			['POST', 'application/json', { update: true }],
			['POST', 'application/json', {}],
			['POST', 'application/json', { update: false, offline: true }]
		]
	);
});

test('an installation that is not valid is an answer, not an error', async t => {
	const report = { ...REPORT, valid: false, diagnostics: [{ code: 'GRAPH_INCOMPLETE', message: 'unresolved', severity: 'error' }] };
	const server = await answering(t, { 'POST /installation': { status: 200, body: report } });

	const answer = await new Connection(server.origin).install();
	assert.equal(answer.valid, false);
	assert.equal(answer.diagnostics[0].code, 'GRAPH_INCOMPLETE');
});

test('a declaration with errors is refused as a contract error that carries its diagnostics', async t => {
	const diagnostics = [{ code: 'WORKSPACE_CONFIG_CONFLICT', message: 'declared twice', severity: 'error' }];
	const error = { code: 'DECLARATION_INVALID', message: 'The workspace is not declared correctly', diagnostics };
	const server = await answering(t, { 'POST /installation': { status: 422, body: { error } } });

	const failure = await failed(new Connection(server.origin).install());
	assert.equal(failure.name, 'ContractError');
	assert.equal(failure.code, 'DECLARATION_INVALID');
	assert.equal(failure.status, 422);
	assert.deepEqual(failure.diagnostics, diagnostics);
});

test('an installation the service never answers is bounded, and its outcome is reported as unknown', async t => {
	const server = await new StallingServer('silent').listen();
	t.after(() => server.close());
	environment(t, 'BEYOND_INSTALL_TIMEOUT', '150');

	const failure = await failed(new Connection(server.origin).install({ update: true }));
	assert.ok(failure instanceof TimeoutError, `expected a TimeoutError, got ${failure}`);
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.equal(failure.method, 'POST');
	assert.equal(failure.path, '/installation');
	assert.equal(failure.outcome, 'unknown');
	assert.match(failure.message, /did not answer POST \/installation within 150ms/);
	assert.match(failure.message, /BEYOND_INSTALL_TIMEOUT/);
	assert.match(failure.message, /unknown.*GET \/installation/);
});

test('an installation whose answer stalls after its headers is bounded as well', async t => {
	const server = await new StallingServer('headers').listen();
	t.after(() => server.close());
	environment(t, 'BEYOND_INSTALL_TIMEOUT', '150');

	const failure = await failed(new Connection(server.origin).install());
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.equal(failure.outcome, 'unknown');
});

test('reading the installation state is bounded like any description, and its outcome is not a change', async t => {
	const server = await new StallingServer('silent').listen();
	t.after(() => server.close());
	environment(t, 'BEYOND_REQUEST_TIMEOUT', '150');

	const failure = await failed(new Connection(server.origin).installation());
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.equal(failure.method, 'GET');
	assert.equal(failure.outcome, 'none');
	assert.match(failure.message, /did not answer GET \/installation within 150ms. Raise BEYOND_REQUEST_TIMEOUT if the host is slow$/);
});

test('a service that cannot answer now is unavailable, not a timeout', async t => {
	const server = await new StallingServer('unavailable').listen();
	t.after(() => server.close());

	const failure = await failed(new Connection(server.origin).install());
	assert.equal(failure.code, 'UNAVAILABLE');
	assert.equal(failure.status, 503);
});

test('an installation whose connection ends before its answer has an unknown outcome, not a transport error', async t => {
	const server = await answering(t, { 'POST /installation': { drop: true } });

	const failure = await failed(new Connection(server.origin).install({ update: true }));
	assert.ok(failure instanceof TimeoutError, `expected a TimeoutError, got ${failure?.name}: ${failure?.message}`);
	assert.equal(failure.code, 'SERVICE_NOT_ANSWERING');
	assert.equal(failure.outcome, 'unknown');
	assert.equal(failure.method, 'POST');
	assert.match(failure.message, /did not answer POST \/installation: the connection ended before its answer/);
	assert.match(failure.message, /unknown.*GET \/installation/);
	assert.ok(failure.cause, 'the transport error is kept as its cause');
	assert.deepEqual(server.requests.map(({ body }) => body), [{ update: true }], 'the request had reached the service');
});

test('an installation nothing accepts is known not to have reached a service', async t => {
	// A port nothing listens on refuses the connection at once
	const server = await new AnsweringServer({}).listen();
	const { origin } = server;
	await server.close();

	const failure = await failed(new Connection(origin).install());
	assert.equal(failure instanceof TimeoutError, false, 'a refused connection is not an unknown outcome');
	assert.equal(failure.cause?.code, 'ECONNREFUSED');
});

test('an error answer that is not a document of the service is the error of its status', async t => {
	const server = await answering(t, {
		'POST /installation': { status: 502, text: '<html>Bad Gateway</html>' },
		'GET /installation': { status: 500, text: 'oops' }
	});
	const connection = new Connection(server.origin);

	const gateway = await failed(connection.install());
	assert.equal(gateway.name, 'ContractError');
	assert.equal(gateway.code, 'UNAVAILABLE');

	const internal = await failed(connection.installation());
	assert.equal(internal.name, 'ContractError');
	assert.equal(internal.code, 'INTERNAL');
});

test('a read whose connection ends is reported as it ended: reading changes nothing', async t => {
	const server = await answering(t, { 'GET /installation': { drop: true } });
	const failure = await failed(new Connection(server.origin).installation());
	assert.equal(failure instanceof TimeoutError, false);
	assert.equal(failure.name, 'TypeError');
});

/**
 * A service that receives an installation and never answers it, telling when a request arrived and when the
 * connection that carried it closed
 */
const holding = async t => {
	let arrived, closed;
	const requests = new Promise(resolve => (arrived = resolve));
	const closes = new Promise(resolve => (closed = resolve));
	const server = createServer(request => {
		request.socket.once('close', closed);
		request.resume();
		arrived();
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	return { origin: `http://127.0.0.1:${server.address().port}`, requests, closes, server };
};

test('a caller that stops waiting for an installation closes its connection, and is told the outcome is unknown', async t => {
	const service = await holding(t);
	const controller = new AbortController();

	const pending = new Connection(service.origin).install({ update: true, signal: controller.signal });
	await service.requests;
	controller.abort();

	const failure = await failed(pending);
	assert.ok(failure instanceof AbortError, `expected an AbortError, got ${failure?.name}: ${failure?.message}`);
	assert.equal(failure instanceof TimeoutError, false, 'the caller stopped it: not a service that did not answer');
	assert.equal(failure.code, 'REQUEST_ABORTED');
	assert.equal(failure.outcome, 'unknown');
	assert.match(failure.message, /POST \/installation .* was stopped by its caller\. Whether it was carried out is unknown: .*GET \/installation/);
	await service.closes;
});

test('a caller that stopped waiting before the installation was sent changed nothing', async t => {
	const service = await holding(t);
	const controller = new AbortController();
	controller.abort(new Error('the user pressed Ctrl+C'));

	const failure = await failed(new Connection(service.origin).install({ signal: controller.signal }));
	assert.equal(failure.code, 'REQUEST_ABORTED');
	assert.equal(failure.outcome, 'none');
	assert.match(failure.message, /stopped by its caller before it was sent$/);
	assert.equal(failure.cause.message, 'the user pressed Ctrl+C');

	const connections = await new Promise(resolve => service.server.getConnections((error, count) => resolve(count)));
	assert.equal(connections, 0, 'nothing reached the service');
});

test('the bound still ends the wait of a caller that gave a signal it never aborts', async t => {
	const service = await holding(t);
	environment(t, 'BEYOND_INSTALL_TIMEOUT', '150');

	const failure = await failed(new Connection(service.origin).install({ signal: new AbortController().signal }));
	assert.ok(failure instanceof TimeoutError, `expected a TimeoutError, got ${failure?.name}`);
	assert.equal(failure.outcome, 'unknown');
	assert.match(failure.message, /within 150ms/);
	await service.closes;
});
