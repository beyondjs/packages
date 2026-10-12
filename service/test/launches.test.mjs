import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stage, backend, gone } from '../../tests/launches/support/stage.mjs';

/**
 * The launch of execution targets (`beyond-launches/1`) with stand-ins for the catalog, the registration and the
 * launcher: the processes are real, each one of the behaviors of `tests/launches/fixtures/stand-ins/launcher.mjs`
 */

const TARGETS = {
	server: backend('server'),
	stubborn: backend('stubborn'),
	silent: backend('silent'),
	partial: backend('partial'),
	crash: backend('crash'),
	finish: backend('finish', { readiness: null }),
	orphan: backend('orphan', { readiness: null }),
	flood: backend('flood'),
	chatty: backend('chatty')
};

/**
 * The line of the stand-in that reports what its process received
 */
const received = lines => JSON.parse(lines.find(line => line.startsWith('environment ')).slice('environment '.length));

test('a backend target runs with the loader of the service, is ready once its readiness appears, and stops on SIGTERM', async t => {
	const environment = { BEYOND_HOST_OPTIONS: '{"token":"start-token"}', BEYOND_SNAPSHOTS_TOKEN: 'secret', BEYOND_AUTHORITY: '{}', LAUNCH_INHERITED: 'kept' };
	// Reserved names the settings file holds are never given: they would change how the target is loaded
	const reserved = { BEE_URL: 'http://elsewhere.example', NODE_OPTIONS: '--no-deprecation', DENO_DIR: '/from/the/settings' };
	const settings = { 'targets.fixture.server.environment': { LAUNCH_VARIABLE: 'from the settings', ...reserved, 'not a name': 'x' } };
	const stage = await new Stage({ targets: TARGETS, environment, settings }).start(t);

	const { status, headers, body } = await stage.launch('server', 'request-0001');
	assert.equal(status, 202);
	assert.match(body.launch.id, /^lch_[0-9a-f]{24}$/);
	assert.equal(headers.get('location'), `/launches/${body.launch.id}`);
	assert.equal(headers.get('cache-control'), 'no-store');
	assert.deepEqual([body.launch.application, body.launch.target, body.launch.specifier, body.launch.environment], ['fixture', 'server', 'stand-in/server', 'node']);
	assert.equal(body.launch.readiness, 'waiting');
	assert.deepEqual(body.launch.diagnostics.map(({ code, name }) => [code, name]), Object.keys(reserved).map(name => ['LAUNCH_VARIABLE_IGNORED', name]), 'the launch says what it did not give');

	const ready = await stage.until(body.launch.id, launch => launch.state === 'ready');
	assert.equal(ready.readiness, 'observed');
	assert.ok(ready.ready && ready.started && Number.isInteger(ready.pid));

	// What the process received: the loader of this service, run from the root, without the service's own settings
	// and credentials, with the target's variables, which never replace the loader configuration
	const lines = await stage.output(body.launch.id);
	const seen = received(lines);
	assert.deepEqual(seen.registered, { url: stage.origin, adapter: 'packages' }, 'the registration ran first, configured for this service');
	assert.deepEqual([seen.BEE_URL, seen.BEE_ADAPTER, seen.BEE_IMPORT_MAP], [stage.origin, 'packages', '']);
	assert.deepEqual([seen.BEYOND_HOST_OPTIONS, seen.BEYOND_SNAPSHOTS_TOKEN, seen.BEYOND_AUTHORITY], [null, null, null]);
	assert.deepEqual([seen.LAUNCH_VARIABLE, seen.LAUNCH_INHERITED], ['from the settings', 'kept']);
	assert.notEqual(seen.NODE_OPTIONS, reserved.NODE_OPTIONS);
	assert.notEqual(seen.DENO_DIR, reserved.DENO_DIR);
	assert.equal(seen.cwd, stage.root);
	assert.deepEqual(seen.argv, ['stand-in/server']);

	// It serves, which the launch does not claim: the case observes it
	const address = lines.find(line => line.startsWith('stand-in listening on ')).slice('stand-in listening on '.length);
	assert.equal(await (await fetch(address, { signal: AbortSignal.timeout(5000) })).text(), 'stand-in answer');

	const stopped = await stage.request('POST', `/launches/${body.launch.id}/stop`);
	assert.equal(stopped.status, 202);
	assert.equal(stopped.body.launch.state, 'stopping');
	const exited = await stage.until(body.launch.id, launch => launch.state === 'exited');
	assert.deepEqual(exited.exit, { code: 0, signal: null });
	assert.ok(exited.ended);
	assert.ok((await stage.output(body.launch.id)).includes('stand-in stopping'));
	assert.equal(gone(ready.pid), true);

	const again = await stage.request('POST', `/launches/${body.launch.id}/stop`);
	assert.deepEqual([again.status, again.body.error.code, again.body.error.details.launch.state], [409, 'LAUNCH_ENDED', 'exited']);

	const states = stage.events.filter(event => event.type === 'launch.changed' && event.launch.id === body.launch.id).map(event => event.launch.state);
	assert.deepEqual(states, ['starting', 'running', 'ready', 'stopping', 'exited']);
	const outputs = stage.events.filter(event => event.type === 'launch.output');
	assert.ok(outputs.length > 0 && outputs.every(event => event.launch.id === body.launch.id && Number.isInteger(event.next)));
});

test('one request identifier is one launch, a target runs once at a time, and simultaneous requests start one process', async t => {
	const stage = await new Stage({ targets: TARGETS }).start(t);
	const first = await stage.launch('silent', 'request-0001');
	assert.equal(first.status, 202);

	const repeated = await stage.launch('silent', 'request-0001');
	assert.deepEqual([repeated.status, repeated.body.launch.id], [200, first.body.launch.id], 'a reload or a lost answer gets the same launch');
	const running = await stage.launch('silent', 'request-0002');
	assert.deepEqual([running.status, running.body.error.code, running.body.error.details.launch.id], [409, 'LAUNCH_RUNNING', first.body.launch.id]);
	const reused = await stage.launch('server', 'request-0001');
	assert.deepEqual([reused.status, reused.body.error.code], [422, 'IDEMPOTENCY_KEY_REUSED']);

	const answers = await Promise.all([stage.launch('server', 'request-0003'), stage.launch('server', 'request-0004')]);
	assert.deepEqual(answers.map(answer => answer.status).sort(), [202, 409], 'two requests at once start one process');
	const started = answers.find(answer => answer.status === 202).body.launch;
	assert.equal(answers.find(answer => answer.status === 409).body.error.details.launch.id, started.id);

	const { body } = await stage.request('GET', '/launches');
	assert.equal(body.protocol, 'beyond-launches/1');
	assert.deepEqual(body.launches.map(launch => launch.id), [started.id, first.body.launch.id], 'the newest first');

	// A target that ended can be launched again, with a new request
	await stage.request('POST', `/launches/${first.body.launch.id}/stop`);
	await stage.until(first.body.launch.id, launch => launch.state === 'exited');
	assert.equal((await stage.launch('silent', 'request-0005')).status, 202);
});

test('a process that ignores SIGTERM is ended with SIGKILL once BEYOND_LAUNCH_STOP passed', async t => {
	const stage = await new Stage({ targets: TARGETS, environment: { BEYOND_LAUNCH_STOP: '300' } }).start(t);
	const { body } = await stage.launch('stubborn', 'request-0001');
	const ready = await stage.until(body.launch.id, launch => launch.state === 'ready');

	const asked = Date.now();
	assert.equal((await stage.request('POST', `/launches/${body.launch.id}/stop`)).status, 202);
	const ended = await stage.until(body.launch.id, launch => launch.state === 'exited', 5000);
	const elapsed = Date.now() - asked;
	assert.deepEqual(ended.exit, { code: null, signal: 'SIGKILL' });
	assert.ok(elapsed >= 250 && elapsed < 3000, `ended ${elapsed}ms after the stop`);
	assert.ok((await stage.output(body.launch.id)).includes('stand-in ignores SIGTERM'), 'it received SIGTERM first');
	assert.equal(gone(ready.pid), true);
});

test('a process that ends by itself fails with the end of its output; one that finishes its work exits', async t => {
	const stage = await new Stage({ targets: TARGETS }).start(t);
	const crash = (await stage.launch('crash', 'request-0001')).body.launch;
	const failed = await stage.until(crash.id, launch => launch.state === 'failed');
	assert.deepEqual(failed.exit, { code: 3, signal: null });
	assert.equal(failed.readiness, 'waiting', 'a process is never said to be ready without its readiness');
	assert.equal(failed.reason.code, 'LAUNCH_EXITED');
	assert.match(failed.reason.message, /with code 3, before its readiness was observed/);
	assert.deepEqual(failed.reason.tail, ['stand-in starting', '[stderr] stand-in failure: the port is taken']);

	const finish = (await stage.launch('finish', 'request-0002')).body.launch;
	const exited = await stage.until(finish.id, launch => launch.state === 'exited');
	assert.deepEqual([exited.exit.code, exited.readiness, exited.reason], [0, 'undeclared', undefined]);

	const partial = (await stage.launch('partial', 'request-0003')).body.launch;
	const ready = await stage.until(partial.id, launch => launch.state === 'ready');
	assert.equal(ready.readiness, 'observed', 'a readiness written without a final newline is observed');
});

test('a Deno executable that is missing is refused at the launch, and nothing starts', async t => {
	const missing = `${process.cwd()}/no such deno`;
	const stage = await new Stage({ targets: { deno: backend('server', { runtime: 'deno' }) }, environment: { BEYOND_DENO: missing } }).start(t);
	const { status, body } = await stage.launch('deno', 'request-0001');
	assert.deepEqual([status, body.error.code, body.error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'DENO_INVALID']);
	assert.match(body.error.message, /does not exist/);
	assert.deepEqual((await stage.request('GET', '/launches')).body.launches, []);
	assert.deepEqual(stage.events, []);
});

test('the end of the service ends every launch within its bound, those that ignore SIGTERM included', async t => {
	const stage = await new Stage({ targets: TARGETS }).start(t);
	const server = (await stage.launch('server', 'request-0001')).body.launch;
	const stubborn = (await stage.launch('stubborn', 'request-0002')).body.launch;
	const pids = await Promise.all([server, stubborn].map(async launch => (await stage.until(launch.id, one => one.state === 'ready')).pid));

	const started = Date.now();
	await stage.feature.stop();
	const elapsed = Date.now() - started;
	assert.ok(elapsed < 5000, `the launches ended in ${elapsed}ms`);
	assert.deepEqual(pids.map(gone), [true, true]);
	const ends = stage.events.filter(event => event.type === 'launch.changed' && ['exited', 'failed'].includes(event.launch.state));
	assert.deepEqual(ends.map(event => [event.launch.target, event.launch.exit.signal]).sort(), [['server', null], ['stubborn', 'SIGKILL']]);
});

test('the end of a launch does not wait for output that a process it left behind keeps open', async t => {
	const stage = await new Stage({ targets: TARGETS }).start(t);
	const { body } = await stage.launch('orphan', 'request-0001');
	const lines = [];
	await stage.until(body.launch.id, launch => launch.state !== 'starting' && launch.state !== 'running', 3000);
	lines.push(...(await stage.output(body.launch.id)));
	const left = Number(/stand-in left (\d+)/.exec(lines.join('\n'))?.[1]);
	t.after(() => !gone(left) && process.kill(left, 'SIGKILL'));
	const ended = (await stage.request('GET', `/launches/${body.launch.id}`)).body.launch;
	assert.deepEqual([ended.state, ended.exit.code], ['exited', 0]);
	assert.equal(gone(left), false, 'the process it left still holds the output');
});

test('the output of a process is read from its last lines as a terminal shows them, and announced at most four times a second', async t => {
	const stage = await new Stage({ targets: TARGETS }).start(t);
	const flood = (await stage.launch('flood', 'request-0001')).body.launch;
	await stage.until(flood.id, launch => launch.state === 'ready');
	const { body } = await stage.request('GET', `/launches/${flood.id}/output?after=0`);
	assert.equal(body.lines.length, 1000);
	assert.equal(body.next, body.lines.at(-1).seq);
	assert.equal(body.dropped, body.lines[0].seq - 1);
	const texts = body.lines.map(line => line.text);
	assert.deepEqual(texts.slice(-3), ['green text', 'progress 100%', 'stand-in listening after the flood']);
	assert.ok(texts.some(text => text.length === 2000 && text.endsWith('…')));
	assert.deepEqual((await stage.request('GET', `/launches/${flood.id}/output?after=${body.next}`)).body, { lines: [], next: body.next, dropped: 0 });

	const chatty = (await stage.launch('chatty', 'request-0002')).body.launch;
	const started = Date.now();
	await stage.until(chatty.id, launch => launch.state === 'ready');
	const elapsed = Date.now() - started;
	const announced = stage.events.filter(event => event.type === 'launch.output' && event.launch.id === chatty.id).length;
	assert.ok(announced >= 2 && announced <= Math.ceil(elapsed / 250) + 2, `${announced} announcements in ${elapsed}ms`);
});
