import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Served } from './support/served.mjs';

/**
 * The launch of execution targets through the real development service of this checkout, with the real catalog of
 * applications, the BEE Node registration and the command line's launcher of the suite: what a service without the
 * `launch` setting refuses to have (PKG-A10), and a backend target of the fixture started, ready, answering, refused a
 * second process and stopped (PKG-A03, PKG-A07).
 */

const served = new Served();
const deno = process.env.BEYOND_DENO;
const observed = {};

before(async () => {
	// A Deno executable of the environment would reach the service: this file asserts the service without one
	delete process.env.BEYOND_DENO;
	try {
		await served.start({ launch: false });
		observed.capabilities = served.session.capabilities;
		observed.list = await served.send('GET', '/launches');
		observed.create = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0000' });
		await served.end();
		await served.start();
	} catch (error) {
		console.error(served.log());
		throw error;
	}
}, { timeout: 900000 });

after(async () => {
	deno !== undefined && (process.env.BEYOND_DENO = deno);
	await served.stop();
}, { timeout: 120000 });

const code = answer => [answer.status, answer.body?.error?.code];

test('a service started without the launch setting has no launch route, claims no launch capability and starts nothing', () => {
	assert.equal(observed.capabilities.launch, undefined);
	assert.equal(observed.capabilities.files, 1, 'it is a service with the development extension all the same');
	assert.deepEqual(code(observed.list), [404, 'NOT_FOUND']);
	assert.deepEqual(code(observed.create), [404, 'NOT_FOUND']);
});

test('a service started with it claims the launch capability and has no launch yet', async () => {
	assert.equal(served.session.capabilities.launch, 1);
	const { status, body } = await served.send('GET', '/launches');
	assert.equal(status, 200);
	assert.deepEqual(body, { protocol: 'beyond-launches/1', launches: [], listeners: [] });
});

test('a backend target starts, is ready once it says so, answers, runs once and stops on request', async t => {
	const stream = await served.events();
	t.after(() => stream.close());
	const created = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0001' });
	assert.equal(created.status, 202, JSON.stringify(created.body));
	const { id } = created.body.launch;
	assert.equal(created.body.launch.specifier, '@launches/api/server');
	assert.equal(created.body.launch.environment, 'node');

	const ready = await served.until(id, launch => launch.state === 'ready' || launch.state === 'failed');
	assert.equal(ready.state, 'ready', JSON.stringify(ready));
	assert.equal(ready.readiness, 'observed');

	// It serves: the case reads the address it printed and asks it, which the launch itself never claims
	const lines = (await served.send('GET', `/launches/${id}/output`)).body.lines.map(line => line.text);
	const address = /fixture API listening on (http:\/\/127\.0\.0\.1:\d+) \(node\)/.exec(lines.join('\n'))?.[1];
	assert.ok(address, lines.join('\n'));
	const health = await (await fetch(`${address}/health`, { signal: AbortSignal.timeout(10000) })).json();
	assert.deepEqual([health.status, health.runtime, health.pid, health.loader], ['ready', 'node', ready.pid, 'packages']);

	// A reload or a lost answer never starts a second process
	const repeated = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0001' });
	assert.deepEqual([repeated.status, repeated.body.launch.id], [200, id]);
	const second = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0002' });
	assert.deepEqual([...code(second), second.body.error.details.launch.id], [409, 'LAUNCH_RUNNING', id]);

	const changed = await stream.until(event => event.type === 'launch.changed' && event.data.launch.id === id && event.data.launch.state === 'ready');
	assert.equal(changed.data.launch.readiness, 'observed', 'the event stream of the development extension carries the launch');

	const stopping = await served.send('POST', `/launches/${id}/stop`);
	assert.equal(stopping.status, 202);
	const exited = await served.until(id, launch => launch.state === 'exited' || launch.state === 'failed', 30000);
	assert.deepEqual([exited.state, exited.exit.code], ['exited', 0]);
	const end = (await served.send('GET', `/launches/${id}/output`)).body.lines.map(line => line.text);
	assert.ok(end.includes('fixture API stopping'), end.join('\n'));
	assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' });
	await assert.rejects(fetch(`${address}/health`, { signal: AbortSignal.timeout(5000) }), 'it no longer answers');
});

test('a target given a port reports its own launch as the listener, and a taken port fails the launch before it starts', async t => {
	const settings = (await served.send('GET', '/settings')).body;
	const port = await new Promise(resolve => {
		const probe = createServer().listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
	const changed = await served.send('PUT', '/settings', { body: { values: { 'targets.fixture.api.environment': { PORT: String(port) } } }, headers: { 'if-match': `"${settings.revision}"` } });
	assert.equal(changed.status, 200, JSON.stringify(changed.body));
	t.after(() => served.send('PUT', '/settings', { body: { values: { 'targets.fixture.api.environment': null } }, headers: { 'if-match': `"${changed.body.document.revision}"` } }));

	const created = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0010' });
	const { id } = created.body.launch;
	const ready = await served.until(id, launch => launch.state === 'ready' || launch.state === 'failed');
	assert.deepEqual([ready.state, ready.port], ['ready', port], JSON.stringify(ready));
	assert.deepEqual((await served.send('GET', '/launches')).body.listeners, [{ application: 'fixture', target: 'api', port, address: '127.0.0.1', launch: id }]);
	await served.send('POST', `/launches/${id}/stop`);
	await served.until(id, launch => launch.state === 'exited' || launch.state === 'failed', 30000);

	// Something else takes the port: the target reports it without a launch, and a launch fails at once
	const other = createServer().listen(port, '127.0.0.1');
	await new Promise(resolve => other.once('listening', resolve));
	t.after(() => new Promise(resolve => other.close(resolve)));
	assert.deepEqual((await served.send('GET', '/launches')).body.listeners, [{ application: 'fixture', target: 'api', port, address: '127.0.0.1' }]);
	const refused = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0011' });
	assert.equal(refused.status, 202);
	assert.deepEqual([refused.body.launch.state, refused.body.launch.pid, refused.body.launch.failure], ['failed', null, { code: 'PORT_IN_USE', message: `Port ${port} is already in use`, port, address: '127.0.0.1' }]);
});

test('a frontend target is opened, not launched, and a Deno target needs an executable', async () => {
	const web = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'web' }, key: 'request-0003' });
	assert.deepEqual([...code(web), web.body.error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'TARGET_FRONTEND']);
	const worker = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'worker' }, key: 'request-0004' });
	assert.deepEqual([...code(worker), worker.body.error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'DENO_NOT_CONFIGURED']);
	const missing = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'nothing' }, key: 'request-0005' });
	assert.deepEqual(code(missing), [404, 'TARGET_NOT_FOUND']);
});

test('a page of another site reaches no launch route', async () => {
	const launched = (await served.send('GET', '/launches')).body.launches;
	const foreign = { origin: 'https://evil.example', authorization: '' };
	const listed = await served.send('GET', '/launches', { headers: foreign });
	assert.equal(listed.status, 401);
	const created = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-0006', headers: foreign });
	assert.equal(created.status, 401);
	assert.deepEqual((await served.send('GET', '/launches')).body.launches, launched, 'nothing was launched');
});
