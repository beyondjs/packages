import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Journal } from '../host/logs/journal.mjs';
import { Collection } from '../host/tests/collection.mjs';
import { Feature } from '../host/tests/index.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/tests/workspace/', import.meta.url));
const STAND_INS = fileURLToPath(new URL('../../tests/launches/fixtures/stand-ins/', import.meta.url));
const LAUNCH = { node: { register: join(STAND_INS, 'register.mjs'), launcher: join(STAND_INS, 'launcher.mjs') } };

/**
 * The tests feature over a copy of the fixture workspace, mounted on an application of its own, with the stand-in
 * registration of the launches' tests as the loader
 */
const serve = async (t, { settings = { pairing: { origins: [] }, launch: LAUNCH }, environment = {} } = {}) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'beyond tests ')));
	cpSync(FIXTURE, root, { recursive: true });
	const events = [];
	const journal = new Journal();
	const feature = new Feature({ root, settings, events: { emit: (type, data) => events.push({ type, ...data }) }, journal, origins: { api: () => 'http://127.0.0.1:9' }, environment: { ...process.env, ...environment } });
	await feature.start();
	const app = express();
	feature.setup(app);
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(async () => {
		await feature.stop();
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		rmSync(root, { recursive: true, force: true });
	});
	const send = async (method, path, body) => {
		const headers = body === undefined ? {} : { 'content-type': 'application/json' };
		const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers, body: body === undefined ? void 0 : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
		return { status: response.status, body: await response.json() };
	};
	const until = async (id, condition, bound = 30000) => {
		const started = Date.now();
		for (;;) {
			const { body } = await send('GET', `/tests/runs/${id}`);
			if (condition(body.run)) return body.run;
			if (Date.now() - started > bound) throw new Error(`The run did not reach the condition within ${bound} ms: ${JSON.stringify(body.run)}`);
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	};
	return { root, feature, events, journal, send, until };
};

test('test files are collected as beyond test collects them, and a named one must be a test file inside the root', () => {
	const collection = new Collection(FIXTURE.replace(/\/$/, ''));
	assert.deepEqual(collection.names, ['math.test.mjs', 'nested/ok.test.mjs', 'slow/hang.test.mjs']);
	assert.deepEqual(new Collection(FIXTURE.replace(/\/$/, ''), ['nested/ok.test.mjs']).names, ['nested/ok.test.mjs']);
	for (const files of [['notes.md'], ['../outside.test.mjs'], ['/abs.test.mjs'], ['missing.test.mjs'], 'math.test.mjs', [7]]) {
		assert.throws(() => new Collection(FIXTURE, files), error => error.code === 'TESTS_FILES_INVALID', JSON.stringify(files));
	}
});

test('a run executes the named files with the loader configuration and reports each test with its location', async t => {
	const { send, until, events, journal, feature } = await serve(t);
	assert.deepEqual(feature.capabilities, { tests: 1 });
	const { status, body } = await send('POST', '/tests/runs', { files: ['math.test.mjs', 'nested/ok.test.mjs'] });
	assert.equal(status, 202);
	assert.match(body.run.id, /^tst_[0-9a-f]{24}$/);
	assert.equal(body.run.state, 'running');
	assert.deepEqual((await send('POST', '/tests/runs', {})).body.error.code, 'TESTS_RUNNING', 'one at a time');

	const run = await until(body.run.id, run => run.state !== 'running');
	assert.equal(run.state, 'failed');
	assert.deepEqual(run.files, ['math.test.mjs', 'nested/ok.test.mjs']);
	assert.deepEqual({ ...run.summary, duration: typeof run.summary.duration }, { tests: 5, passed: 3, failed: 1, skipped: 1, duration: 'number' });
	const byName = Object.fromEntries(run.results.map(result => [result.name, result]));
	assert.deepEqual(Object.keys(byName).sort(), ['adds', 'later', 'nested passes', 'receives the loader configuration', 'subtracts']);
	assert.deepEqual([byName.adds.file, byName.adds.state], ['math.test.mjs', 'passed']);
	assert.equal(byName['receives the loader configuration'].state, 'passed', 'the runner was given the loader configuration');
	assert.equal(byName.later.state, 'skipped');
	const failed = byName.subtracts;
	assert.equal(failed.state, 'failed');
	assert.match(failed.error.message, /Expected values to be strictly equal/);
	assert.deepEqual([failed.error.location.file, failed.error.location.line], ['math.test.mjs', 15]);
	assert.ok(failed.error.location.column > 0);

	assert.ok(events.some(({ type, run }) => type === 'tests.changed' && run.state === 'failed'), 'the end is announced');
	assert.deepEqual(journal.read().entries.map(({ level, source, message }) => [level, source, message]), [
		['info', 'tests', 'Tests started: 2 files'],
		['error', 'tests', 'Tests failed: 3 passed, 1 failed, 1 skipped']
	]);
	assert.deepEqual((await send('GET', '/tests/runs')).body.runs.map(({ id }) => id), [run.id]);
});

test('a run is cancelled on request, and one past its bound is cancelled with TESTS_TIMEOUT', async t => {
	const { send, until } = await serve(t, { environment: { BEYOND_TESTS_TIMEOUT: '60000' } });
	const { body } = await send('POST', '/tests/runs', { files: ['slow/hang.test.mjs'] });
	const cancelled = await send('POST', `/tests/runs/${body.run.id}/cancel`);
	assert.equal(cancelled.status, 202);
	const run = await until(body.run.id, run => run.state !== 'running');
	assert.deepEqual([run.state, run.reason.code], ['cancelled', 'TESTS_CANCELLED']);
	assert.equal((await send('POST', `/tests/runs/${body.run.id}/cancel`)).body.error.code, 'TESTS_RUN_ENDED');

	const bounded = await serve(t, { environment: { BEYOND_TESTS_TIMEOUT: '500' } });
	const started = (await bounded.send('POST', '/tests/runs', { files: ['slow/hang.test.mjs'] })).body.run;
	const timed = await bounded.until(started.id, run => run.state !== 'running');
	assert.deepEqual([timed.state, timed.reason.code], ['cancelled', 'TESTS_TIMEOUT']);
});

test('requests that cannot run are refused, and a service that cannot run tests claims nothing', async t => {
	const { send } = await serve(t);
	assert.deepEqual([(await send('POST', '/tests/runs', { files: ['notes.md'] })).status], [400]);
	assert.deepEqual((await send('GET', '/tests/runs/tst_000000000000000000000000')).body.error.code, 'TESTS_RUN_NOT_FOUND');

	for (const settings of [{ pairing: { origins: [] } }, { launch: LAUNCH }, { pairing: { origins: [], public: 'https://space.example' }, launch: LAUNCH }]) {
		const feature = new Feature({ root: tmpdir(), settings, environment: {} });
		await feature.start();
		assert.deepEqual(feature.capabilities, {}, JSON.stringify(settings));
	}
	const delegated = new Feature({ root: tmpdir(), settings: { pairing: { origins: [] }, launch: LAUNCH }, environment: { BEYOND_AUTHORITY: '{}' } });
	await delegated.start();
	assert.deepEqual(delegated.capabilities, {});
});
