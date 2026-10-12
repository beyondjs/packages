import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Durations } from '../host/operations/durations.mjs';
import { Operations } from '../host/operations/operations.mjs';
import { OperationRoutes } from '../host/operations/routes.mjs';

/**
 * A workspace directory of its own, removed after the case
 */
const root = async t => {
	const directory = await mkdtemp(join(tmpdir(), 'beyond-operations-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
};

/**
 * The events an operations registry announces
 */
class Announced {
	list = [];
	emit(type, data) {
		this.list.push({ type, ...data });
	}
}

/**
 * A clock the case moves
 */
class Clock {
	#now = Date.parse('2026-10-11T12:00:00Z');
	now() {
		return this.#now;
	}
	advance(milliseconds) {
		this.#now += milliseconds;
	}
}

/**
 * Work the case ends
 */
const gate = () => {
	let open;
	const promise = new Promise(resolve => (open = resolve));
	return { promise, open };
};

/**
 * Waits until a condition holds, failing past a bound instead of hanging
 */
const until = async (condition, bound = 5000) => {
	const started = Date.now();
	while (!(await condition())) {
		if (Date.now() - started > bound) throw new Error('The condition did not hold within the bound');
		await new Promise(resolve => setTimeout(resolve, 10));
	}
};

test('an operation runs its work, reports its steps and ends with its result', async t => {
	const events = new Announced();
	const clock = new Clock();
	const operations = new Operations({ root: await root(t), events, clock });
	await operations.start();

	const work = gate();
	const { operation, created } = await operations.run(
		{ kind: 'dependencies.check', scope: { workspace: true }, steps: [{ id: 'metadata', expected: { median: 4000 } }, { id: 'compare' }] },
		async operation => {
			operation.step('metadata').begin({ phase: 'download' }).count(1, 3, 'packages').current('react@19.1.1');
			clock.advance(2500);
			await work.promise;
			operation.step('metadata').done();
			operation.step('compare').begin().done();
			return { outdated: 1 };
		}
	);
	assert.equal(created, true);
	assert.match(operation.id, /^op_[0-9a-f]{24}$/);
	assert.equal(operation.state, 'running');

	await until(async () => (await operations.get(operation.id)).steps[0].state === 'progress');
	const running = await operations.get(operation.id);
	assert.deepEqual(running.steps[0].counts, { done: 1, total: 3, unit: 'packages' });
	assert.equal(running.steps[0].current, 'react@19.1.1');
	assert.deepEqual(running.steps[0].phase.label, 'download');
	assert.deepEqual(running.steps[0].expected, { median: 4000, p90: 8000, source: 'default', samples: 0 });

	work.open();
	await until(async () => (await operations.get(operation.id)).state === 'succeeded');
	await operations.idle();
	const ended = await operations.get(operation.id);
	assert.deepEqual(ended.result, { outdated: 1 });
	assert.equal(ended.steps[0].state, 'done');
	assert.equal(ended.steps[0].until, '2026-10-11T12:00:02.500Z');
	assert.ok(events.list.some(event => event.type === 'operation.changed' && event.operation.state === 'succeeded'));
	assert.ok(events.list.every(event => event.operation.result === undefined), 'an announcement carries no result');
});

test('the same request identifier answers the operation it created, and never starts the work twice', async t => {
	const operations = new Operations({ root: await root(t) });
	await operations.start();
	let runs = 0;
	const specs = { kind: 'dependencies.apply', key: 'request-0001', steps: [{ id: 'write' }] };
	const first = await operations.run(specs, async () => void runs++);
	const second = await operations.run(specs, async () => void runs++);
	assert.equal(second.created, false);
	assert.equal(second.operation.id, first.operation.id);
	await until(async () => (await operations.get(first.operation.id)).state === 'succeeded');
	assert.equal(runs, 1);

	// Another kind with the same identifier is another request
	const other = await operations.run({ kind: 'dependencies.plan', key: 'request-0001', steps: [{ id: 'resolve' }] }, async () => {});
	assert.equal(other.created, true);
	await operations.idle();
});

test('an operation that was running when the service stopped is interrupted with an unknown outcome', async t => {
	const directory = await root(t);
	const before = new Operations({ root: directory });
	await before.start();
	const never = gate();
	const { operation } = await before.run({ kind: 'production.publish', key: 'publish-0001', steps: [{ id: 'publish' }] }, async operation => {
		operation.step('publish').begin();
		await never.promise;
	});
	await until(async () => (await before.get(operation.id)).steps[0].state === 'progress');
	await before.settled();

	// Another service on the same workspace reads what the stopped one left
	const after = new Operations({ root: directory });
	await after.start();
	const record = await after.get(operation.id);
	assert.equal(record.state, 'interrupted');
	assert.equal(record.outcome, 'unknown');
	assert.equal(record.error.code, 'OPERATION_INTERRUPTED');
	assert.equal(record.steps[0].state, 'failed');

	// Its request identifier still answers it rather than starting the work again
	const again = await after.run({ kind: 'production.publish', key: 'publish-0001', steps: [{ id: 'publish' }] }, async () => assert.fail('started twice'));
	assert.equal(again.created, false);
	assert.equal(again.operation.state, 'interrupted');

	// The work of the first registry ends with the case, before its directory is removed
	never.open();
	await before.idle();
	await after.idle();
});

test('a cancellable operation stops through its signal and ends cancelled; an ended one refuses', async t => {
	const operations = new Operations({ root: await root(t) });
	await operations.start();
	const { operation } = await operations.run({ kind: 'dependencies.check', cancellable: true, steps: [{ id: 'metadata' }] }, async operation => {
		operation.step('metadata').begin();
		await new Promise((resolve, reject) => operation.signal.addEventListener('abort', () => reject(operation.signal.reason)));
	});
	await until(async () => (await operations.get(operation.id)).steps[0].state === 'progress');
	const cancelled = await operations.cancel(operation.id);
	assert.equal(cancelled.id, operation.id);
	await until(async () => (await operations.get(operation.id)).state === 'cancelled');
	await assert.rejects(operations.cancel(operation.id), { code: 'OPERATION_ENDED' });
	await operations.settled();

	const held = gate();
	const fixed = await operations.run({ kind: 'dependencies.apply', steps: [{ id: 'write' }] }, () => held.promise);
	await assert.rejects(operations.cancel(fixed.operation.id), { code: 'OPERATION_NOT_CANCELLABLE' });
	await assert.rejects(operations.get('op_000000000000000000000000'), { code: 'OPERATION_NOT_FOUND' });
	held.open();
	await operations.idle();
});

test('a failure ends the operation and the step in progress with its reason', async t => {
	const operations = new Operations({ root: await root(t) });
	await operations.start();
	const { operation } = await operations.run({ kind: 'dependencies.plan', steps: [{ id: 'resolve' }, { id: 'compare' }] }, async operation => {
		operation.step('resolve').begin();
		throw Object.assign(new Error('react@20 is not in the registry'), { code: 'VERSION_NOT_FOUND' });
	});
	await until(async () => (await operations.get(operation.id)).state === 'failed');
	const record = await operations.get(operation.id);
	assert.deepEqual(record.error, { code: 'VERSION_NOT_FOUND', message: 'react@20 is not in the registry' });
	assert.equal(record.steps[0].state, 'failed');
	assert.equal(record.steps[1].state, 'waiting');
	await operations.idle();
});

test('usual durations come from measured steps once there are enough of them', async t => {
	const directory = await root(t);
	const durations = new Durations(join(directory, '.beyond', 'operations'));
	await durations.load();
	assert.deepEqual(durations.expected('export.web', 'write', { median: 3000 }), { median: 3000, p90: 6000, source: 'default', samples: 0 });
	[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].forEach(value => durations.record('export.web', 'write', value));
	assert.deepEqual(durations.expected('export.web', 'write', { median: 3000 }), { median: 500, p90: 900, source: 'measured', samples: 10 });
	await durations.settled();
	const stored = JSON.parse(await readFile(join(directory, '.beyond', 'operations', 'durations.json'), 'utf8'));
	assert.equal(stored['export.web/write'].length, 10);
});

test('the routes list, read and cancel operations in the envelope of the service', async t => {
	const operations = new Operations({ root: await root(t) });
	await operations.start();
	const app = express();
	new OperationRoutes(operations).setup(app);
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	const origin = `http://127.0.0.1:${server.address().port}`;

	const { operation } = await operations.run({ kind: 'dependencies.check', cancellable: true, steps: [{ id: 'metadata' }] }, operation =>
		new Promise((resolve, reject) => operation.signal.addEventListener('abort', () => reject(operation.signal.reason)))
	);

	const listed = await (await fetch(`${origin}/operations?kind=dependencies`)).json();
	assert.equal(listed.protocol, 'beyond-dev-operations/1');
	assert.equal(listed.operations[0].id, operation.id);

	const missing = await fetch(`${origin}/operations/op_000000000000000000000000`);
	assert.equal(missing.status, 404);
	assert.equal((await missing.json()).error.code, 'OPERATION_NOT_FOUND');

	const form = await fetch(`${origin}/operations/${operation.id}/cancel`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
	assert.equal(form.status, 415);

	const cancel = await fetch(`${origin}/operations/${operation.id}/cancel`, { method: 'POST' });
	assert.equal(cancel.status, 202);
	await until(async () => (await operations.get(operation.id)).state === 'cancelled');
	const again = await fetch(`${origin}/operations/${operation.id}/cancel`, { method: 'POST' });
	assert.equal(again.status, 409);
	assert.equal((await again.json()).error.code, 'OPERATION_ENDED');
	await operations.idle();
});
