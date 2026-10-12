import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Operations } from '../host/operations/operations.mjs';
import { Owner } from '../host/operations/owner.mjs';

/**
 * The operations of several hosts on one root, and how they are announced: each record names the host that runs it
 * (`Owner`), a starting host interrupts only what a host that is gone left, and the changes of a running operation are
 * `operation.changed` when they are important and transient `operation.progress` otherwise, at most four a second.
 */

/**
 * A workspace directory of its own, removed after the case
 */
const root = async t => {
	const directory = await mkdtemp(join(tmpdir(), 'beyond-operations-hosts-'));
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

/**
 * A process of this machine that lives until the case ends it, standing for another host
 */
const host = t => {
	const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
	const exited = new Promise(resolve => child.once('exit', resolve));
	t.after(() => (child.exitCode === null && child.signalCode === null ? (child.kill('SIGKILL'), exited) : void 0));
	return { pid: child.pid, end: () => (child.kill('SIGKILL'), exited) };
};

test('a host that starts on a root another live host serves never interrupts or removes what that host runs', async t => {
	const directory = await root(t);
	const other = host(t);
	const first = new Operations({ root: directory, owner: new Owner({ pid: other.pid, token: 'first-host' }) });
	await first.start();
	const held = gate();
	t.after(() => held.open());
	const { operation } = await first.run({ kind: 'dependencies.apply', key: 'apply-0001', steps: [{ id: 'write' }] }, async operation => {
		operation.step('write').begin();
		await held.promise;
	});
	await until(async () => (await first.get(operation.id)).steps[0].state === 'progress');
	await first.settled();

	const stored = JSON.parse(await readFile(join(directory, '.beyond', 'operations', `${operation.id}.json`), 'utf8'));
	assert.deepEqual(stored.owner, { pid: other.pid, token: 'first-host' }, 'the record names the host that runs it');
	assert.equal((await first.get(operation.id)).owner, void 0, 'and the routes answer no owner');

	// A second host on the same root, even one that keeps nothing (retention 0), leaves the record as it is
	const second = new Operations({ root: directory, retention: 0 });
	await second.start();
	const seen = await second.get(operation.id);
	assert.deepEqual([seen.state, seen.steps[0].state, seen.owner], ['running', 'progress', void 0]);
	assert.deepEqual((await second.list()).map(({ id, state }) => [id, state]), [[operation.id, 'running']]);
	const repeated = await second.run({ kind: 'dependencies.apply', key: 'apply-0001', steps: [{ id: 'write' }] }, async () => assert.fail('started twice'));
	assert.deepEqual([repeated.created, repeated.operation.id], [false, operation.id], 'its request identifier answers it there as well');

	// Once that host is gone, the next start says what happened to its work
	await other.end();
	const third = new Operations({ root: directory });
	await third.start();
	const interrupted = await third.get(operation.id);
	assert.deepEqual([interrupted.state, interrupted.outcome, interrupted.error.code], ['interrupted', 'unknown', 'OPERATION_INTERRUPTED']);

	held.open();
	await first.idle();
});

test('an owner is gone when its process is, or when it was an earlier process with this one\'s identifier', async t => {
	const owner = new Owner();
	const other = host(t);
	assert.equal(owner.gone(owner.toJSON()), false, 'its own records');
	assert.equal(owner.gone({ pid: process.pid, token: 'an-earlier-start' }), true, 'an earlier process that had this identifier');
	assert.equal(owner.gone({ pid: other.pid, token: 'other' }), false, 'a live process');
	assert.equal(owner.gone(void 0), true, 'a record that names no owner');
	assert.equal(owner.gone({ pid: 'x' }), true);
	await other.end();
	assert.equal(owner.gone({ pid: other.pid, token: 'other' }), true, 'a process that ended');
	assert.equal(owner.owns(owner.toJSON()), true);
	assert.equal(owner.owns({ pid: process.pid, token: 'an-earlier-start' }), false);
});

test('counts are announced as transient progress at most four times a second, and important changes as changes', async t => {
	const events = new Announced();
	const operations = new Operations({ root: await root(t), events });
	await operations.start();
	const work = gate();
	const { operation } = await operations.run({ kind: 'dependencies.check', steps: [{ id: 'metadata' }, { id: 'compare' }] }, async operation => {
		const step = operation.step('metadata').begin({ phase: 'metadata' });
		const started = Date.now();
		for (let done = 1; Date.now() - started < 1000; done++) {
			step.count(done, void 0, 'packages').current(`package-${done}`);
			step.phase('metadata');
			await new Promise(resolve => setTimeout(resolve, 5));
		}
		await work.promise;
		step.done();
		operation.step('compare').begin().done();
	});

	await until(() => events.list.filter(({ type }) => type === 'operation.progress').length >= 3, 3000);
	work.open();
	await until(async () => (await operations.get(operation.id)).state === 'succeeded');
	await operations.idle();

	const progress = events.list.filter(({ type }) => type === 'operation.progress');
	assert.ok(progress.length >= 3 && progress.length <= 6, `${progress.length} progress announcements in about a second`);
	assert.ok(progress.every(({ operation: one }) => one.id === operation.id && one.state === 'running' && one.result === void 0));
	assert.ok(progress.at(-1).operation.steps[0].counts.done > progress[0].operation.steps[0].counts.done, 'each carries the counts of its moment');

	// The begin of each step, its end and the end of the operation are changes; the counts and the same phase told again are not
	const changes = events.list.filter(({ type }) => type === 'operation.changed').map(({ operation: one }) => [one.state, ...one.steps.map(step => step.state)]);
	assert.deepEqual(changes, [
		['running', 'waiting', 'waiting'],
		['running', 'progress', 'waiting'],
		['running', 'done', 'waiting'],
		['running', 'done', 'progress'],
		['running', 'done', 'done'],
		['succeeded', 'done', 'done']
	]);
});
