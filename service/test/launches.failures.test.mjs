import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Failure } from '../host/launches/failure.mjs';
import { Ports } from '../host/launches/ports.mjs';
import { Stage, backend } from '../../tests/launches/support/stage.mjs';

/**
 * Why a launch failed, in a person's words (`failure`), and what already listens on a target's port (`listeners`)
 */

/**
 * A port something listens on, held until the case ends
 */
const occupy = async t => {
	const server = createServer(socket => socket.end());
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	return server.address().port;
};

/**
 * A port nothing listens on: one the system gave and took back
 */
const free = async () => {
	const server = createServer();
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	await new Promise(resolve => server.close(resolve));
	return port;
};

test('a failure is classified from the output and the exit, the raw output aside', () => {
	const cases = [
		[['Error: listen EADDRINUSE: address already in use 127.0.0.1:5231', '    at Server.setupListenHandle'], { code: 'PORT_IN_USE', message: 'Port 5231 is already in use', port: 5231, address: '127.0.0.1' }],
		[['Error: listen EADDRINUSE: address already in use :::4000'], { code: 'PORT_IN_USE', message: 'Port 4000 is already in use', port: 4000, address: '::' }],
		[['Error: listen EACCES: permission denied 0.0.0.0:80'], { code: 'PERMISSION_DENIED', message: 'Permission denied to listen on port 80', port: 80, address: '0.0.0.0' }],
		[["Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from /work/api/server.js"], { code: 'MODULE_MISSING', message: 'express is imported by /work/api/server.js but is not a dependency of its package: add it to its dependencies and run beyond install', specifier: 'express' }],
		[['/work/api/server.js:3', 'const = 1;', '      ^', '', 'SyntaxError: Unexpected token \'=\''], { code: 'SYNTAX', message: "Syntax error: Unexpected token '='" }],
		[['Error: EACCES: permission denied, open \'/etc/secret\''], { code: 'EXITED', message: 'The process ended by itself with code 1' }],
		[['nothing to say'], { code: 'EXITED', message: 'The process ended by itself with code 1' }]
	];
	for (const [lines, expected] of cases) assert.deepEqual(Failure.of({ lines, code: 1 }), expected, lines[0]);
	assert.deepEqual(Failure.of({ lines: [], code: null, signal: 'SIGKILL' }), { code: 'EXITED', message: 'The process was ended by the signal SIGKILL' });
});

test('a launch whose port is taken fails at once with PORT_IN_USE and starts no process', async t => {
	const port = await occupy(t);
	const stage = await new Stage({ targets: { port: backend('port') }, settings: { 'targets.fixture.port.environment': { PORT: String(port) } } }).start(t);
	const { status, body } = await stage.launch('port', 'request-0001');
	assert.equal(status, 202);
	assert.equal(body.launch.state, 'failed');
	assert.equal(body.launch.pid, null, 'no process');
	assert.deepEqual(body.launch.failure, { code: 'PORT_IN_USE', message: `Port ${port} is already in use`, port, address: '127.0.0.1' });
	assert.equal(body.launch.port, port);
	assert.equal(body.launch.reason.code, 'LAUNCH_REFUSED');
});

test('a free port launches, and the target then reports its own launch as the listener', async t => {
	const port = await free();
	const catalog = {
		resolve: async () => backend('port'),
		catalog: () => ({ applications: [{ id: 'fixture', targets: [{ id: 'port', kind: 'backend' }, { id: 'web', kind: 'frontend' }] }] })
	};
	const stage = await new Stage({ catalog, settings: { 'targets.fixture.port.environment': { PORT: String(port) } } }).start(t);
	assert.deepEqual((await stage.request('GET', '/launches')).body.listeners, [], 'nothing listens yet');

	const { body } = await stage.launch('port', 'request-0001');
	await stage.until(body.launch.id, launch => launch.state === 'ready');
	const { listeners } = (await stage.request('GET', '/launches')).body;
	assert.deepEqual(listeners, [{ application: 'fixture', target: 'port', port, address: '127.0.0.1', launch: body.launch.id }]);

	await stage.request('POST', `/launches/${body.launch.id}/stop`);
	await stage.until(body.launch.id, launch => launch.state === 'exited');
});

test('a listener started outside the service is reported without a launch', async t => {
	const port = await occupy(t);
	const catalog = { resolve: async () => backend('port'), catalog: () => ({ applications: [{ id: 'fixture', targets: [{ id: 'api', kind: 'backend', port }] }] }) };
	const stage = await new Stage({ catalog }).start(t);
	assert.deepEqual((await stage.request('GET', '/launches')).body.listeners, [{ application: 'fixture', target: 'api', port, address: '127.0.0.1' }], 'the declared port');
	assert.equal(await new Ports({ bound: 200 }).listener(await free()), undefined);
	assert.deepEqual([Ports.of({ PORT: '80' }), Ports.of({ PORT: 'x' }, { port: 81 }), Ports.of({}, { port: 70000 })], [80, 81, undefined]);
});

test('a process that fails with an uncaught EADDRINUSE, a missing package or a syntax error says why', async t => {
	const stage = await new Stage({ targets: { busy: backend('busy'), missing: backend('missing'), crash: backend('crash') } }).start(t);
	const ended = async (target, key) => {
		const { body } = await stage.launch(target, key);
		return stage.until(body.launch.id, launch => launch.state === 'failed');
	};

	const busy = await ended('busy', 'request-0001');
	assert.equal(busy.failure.code, 'PORT_IN_USE');
	assert.match(busy.failure.message, /^Port \d+ is already in use$/);
	assert.ok(busy.reason.tail.length, 'the raw output stays');

	const missing = await ended('missing', 'request-0002');
	assert.deepEqual([missing.failure.code, missing.failure.specifier], ['MODULE_MISSING', 'stand-in-not-a-dependency']);

	const crash = await ended('crash', 'request-0003');
	assert.deepEqual(crash.failure, { code: 'EXITED', message: 'The process ended by itself with code 3' });
});
