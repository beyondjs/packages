import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Startup } from '../startup.mjs';

const SUPERVISOR = fileURLToPath(new URL('./support/supervisor.mjs', import.meta.url));

const alive = pid => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

/**
 * Starts the stand-in supervisor as `Service` starts the real one, and ends what is left of it after the test
 */
const supervisor = (t, ...args) => {
	const child = spawn(process.execPath, [SUPERVISOR, ...args], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
	t.after(() => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			// Already ended by the case
		}
	});
	return child;
};

/**
 * Waits for a condition, failing instead of hanging when it does not arrive
 */
const until = async (condition, what, limit = 5000) => {
	const deadline = Date.now() + limit;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await sleep(10);
	}
};

test('a supervisor that never reports is stopped, and the start fails named, with its log', async t => {
	const child = supervisor(t, 'silent');
	const failure = await new Startup(child, { deadline: 200, log: '/services/x/service.log' }).outcome().then(
		() => undefined,
		error => error
	);

	assert.equal(failure?.name, 'ServiceError');
	assert.equal(failure.code, 'SERVICE_START_TIMEOUT');
	assert.equal(failure.log, '/services/x/service.log');
	assert.match(failure.message, /did not become ready within 200ms and was stopped/);
	assert.match(failure.message, /BEYOND_START_TIMEOUT/);
	assert.equal(alive(child.pid), false, 'the supervisor it started is gone when the start is reported');
});

test('a supervisor that ignores the request to end is killed with its process group', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'beyond-startup-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const file = join(directory, 'grandchild.pid');

	const child = supervisor(t, 'stubborn', file);
	await until(() => existsSync(file) && readFileSync(file, 'utf8'), 'the stand-in to start its child');
	const grandchild = Number(readFileSync(file, 'utf8'));
	t.after(() => alive(grandchild) && process.kill(grandchild, 'SIGKILL'));

	const failure = await new Startup(child, { deadline: 50, grace: 200 }).outcome().then(
		() => undefined,
		error => error
	);

	assert.equal(failure?.code, 'SERVICE_START_TIMEOUT');
	assert.match(failure.message, /was killed/);
	assert.equal(alive(child.pid), false, 'the supervisor is gone');
	await until(() => !alive(grandchild), 'the child in its group to end', 2000);
});

test('a supervisor that reports ready within the deadline gives its record', async t => {
	const child = supervisor(t, 'ready');
	const record = await new Startup(child, { deadline: 5000 }).outcome();
	assert.equal(record.pid, child.pid);
});
