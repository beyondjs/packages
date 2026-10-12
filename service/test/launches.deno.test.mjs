import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '../host/launches/command.mjs';
import { Stage, backend, gone } from '../../tests/launches/support/stage.mjs';

/**
 * A Deno target through the feature, with a stand-in Deno executable (`tests/launches/fixtures/stand-ins/deno.mjs`)
 * that reports what it was given and behaves as a server. The real Deno is exercised by `tests/launches/deno.test.mjs`
 * when `BEYOND_DENO` names one.
 */

const WORKER = { worker: backend('worker', { runtime: 'deno', readiness: 'stand-in listening in deno' }) };

test('a Deno target runs the configured executable over the entry of the feature, with the import map of the service', async t => {
	const stage = await new Stage({ targets: WORKER, environment: { BEYOND_DENO: Stage.deno(t) } }).start(t);
	const { status, body } = await stage.launch('worker', 'request-0001');
	assert.equal(status, 202);
	assert.equal(body.launch.environment, 'deno');
	const ready = await stage.until(body.launch.id, launch => launch.state === 'ready');

	const line = (await stage.output(body.launch.id)).find(text => text.startsWith('deno '));
	const seen = JSON.parse(line.slice('deno '.length));
	assert.deepEqual(seen.args.slice(0, 6), ['run', '--no-config', '--no-lock', '--allow-net', '--allow-import', '--allow-env']);
	assert.ok(seen.args.includes(`--import-map=${stage.origin}/importmap.json?target=node&format=esm`));
	assert.ok(seen.args.includes(`--reload=${stage.origin}/`));
	assert.deepEqual(seen.args.slice(-2), [Command.ENTRY, 'stand-in/worker']);
	assert.equal(seen.entry, 'exists');
	const cache = join(stage.root, '.beyond', 'launches', 'deno');
	assert.deepEqual([seen.DENO_DIR, seen.directory, seen.NO_COLOR, seen.BEE_URL], [cache, true, '1', null]);

	assert.equal((await stage.request('POST', `/launches/${body.launch.id}/stop`)).status, 202);
	const exited = await stage.until(body.launch.id, launch => launch.state === 'exited');
	assert.deepEqual(exited.exit, { code: 0, signal: null });
	assert.equal(gone(ready.pid), true);
	assert.equal(existsSync(cache), true);
});

test('the executable the launch setting names is used before the one of the environment', async t => {
	const launch = { node: { register: '/r.mjs', launcher: '/l.mjs' }, deno: { executable: Stage.deno(t) } };
	const stage = await new Stage({ targets: WORKER, launch, environment: { BEYOND_DENO: '/no/such/deno' } }).start(t);
	const { body } = await stage.launch('worker', 'request-0001');
	const settled = await stage.until(body.launch.id, one => ['ready', 'failed'].includes(one.state));
	assert.equal(settled.state, 'ready', JSON.stringify(settled));
});

test('without an executable a Deno target is refused, and nothing is created in the workspace', async t => {
	const stage = await new Stage({ targets: WORKER, environment: { BEYOND_DENO: '' } }).start(t);
	const { status, body } = await stage.launch('worker', 'request-0001');
	assert.deepEqual([status, body.error.code, body.error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'DENO_NOT_CONFIGURED']);
	assert.equal(existsSync(join(stage.root, '.beyond')), false);
});

test('the Deno executable is checked at every launch: one replaced by another program since the last launch is refused', async t => {
	const executable = Stage.deno(t);
	const stage = await new Stage({ targets: WORKER, environment: { BEYOND_DENO: executable } }).start(t);
	const first = await stage.launch('worker', 'request-0001');
	assert.equal(first.status, 202, JSON.stringify(first.body));
	await stage.until(first.body.launch.id, launch => launch.state === 'ready');
	await stage.request('POST', `/launches/${first.body.launch.id}/stop`);
	await stage.until(first.body.launch.id, launch => launch.state === 'exited');

	// The file now answers as another program, as a Deno 1 executable or something else put in its place would
	writeFileSync(executable, '#!/bin/sh\necho "deno 1.46.3 (stable, release)"\n');
	chmodSync(executable, 0o755);
	const refused = await stage.launch('worker', 'request-0002');
	assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'DENO_INVALID']);
	assert.match(refused.body.error.message, /is Deno 1\.46\.3, and Deno 2 is required/);
	assert.deepEqual((await stage.request('GET', '/launches')).body.launches.map(({ id }) => id), [first.body.launch.id], 'nothing else was launched');
});
