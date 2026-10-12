import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog } from '../host/settings/catalog.mjs';
import { Changes } from '../host/settings/changes.mjs';
import { Deno } from '../host/settings/deno.mjs';

/**
 * The `launch.deno` setting: an absolute path to an executable that answers `--version` as Deno 2 within a bound.
 * The executables are stand-in shell scripts of two or three lines, written into a temporary directory by each case:
 * they print what a Deno of some version prints, something else, or nothing while they hang.
 */
const directory = async t => {
	const created = await mkdtemp(join(tmpdir(), 'beyond-deno-'));
	t.after(() => rm(created, { recursive: true, force: true }));
	return created;
};

/**
 * A stand-in executable with the given body
 */
const script = async (t, body, mode = 0o755) => {
	const file = join(await directory(t), 'deno');
	await writeFile(file, `#!/bin/sh\n${body}\n`);
	await chmod(file, mode);
	return file;
};

/**
 * Whether a process of this machine still runs
 */
const alive = pid => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

const until = async (condition, bound = 5000) => {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > bound) throw new Error('The condition did not hold within the bound');
		await new Promise(resolve => setTimeout(resolve, 20));
	}
};

test('an executable that answers as Deno 2 is accepted with its version', async t => {
	const file = await script(t, 'echo "deno 2.1.4 (stable, release, aarch64-apple-darwin)"\necho "v8 13.0.245.12"');
	assert.deepEqual(await new Deno({ timeout: 5000 }).check(file), { version: '2.1.4' });
	const changes = new Changes(new Catalog({}, { deno: new Deno({ timeout: 5000 }) }));
	assert.deepEqual(await changes.validate({ 'launch.deno': file }), { 'launch.deno': file });
});

test('another version, another program and an executable that prints nothing are refused with what they answered', async t => {
	const deno = new Deno({ timeout: 5000 });
	assert.match((await deno.check(await script(t, 'echo "deno 1.46.3 (stable, release)"'))).message, /is Deno 1\.46\.3, and Deno 2 is required/);
	assert.match((await deno.check(await script(t, 'echo "v22.21.1"'))).message, /answered "--version" with "v22\.21\.1", which is not Deno's answer/);
	assert.match((await deno.check(await script(t, 'exit 0'))).message, /printed nothing/);
});

test('an executable that does not answer within the bound is refused, and what it started is ended', async t => {
	const pids = join(await directory(t), 'pids');
	// The shell starts a child that keeps the output open, so waiting for the streams to close would never end
	const file = await script(t, `sleep 30 &\necho "$$ $!" > "${pids}.tmp"\nmv "${pids}.tmp" "${pids}"\nwait`);
	const started = Date.now();
	const checking = new Deno({ timeout: 2000 }).check(file);

	// Both processes run while the check waits: the bound leaves a loaded machine time to start them
	await until(() => existsSync(pids), 2000);
	const [shell, child] = readFileSync(pids, 'utf8').trim().split(' ').map(Number);
	assert.ok(alive(shell) && alive(child));

	const answer = await checking;
	assert.match(answer.message, /did not answer "--version" within 2000 ms/);
	assert.ok(Date.now() - started < 5000, `answered at the bound, not after the child it started (${Date.now() - started} ms)`);
	await until(() => !alive(shell) && !alive(child));
});

test('a path that is not an absolute path to an executable file is refused before anything runs', async t => {
	const changes = new Changes(new Catalog({}, { deno: new Deno({ timeout: 5000 }) }));
	const empty = await directory(t);
	const plain = await script(t, 'echo "deno 2.1.4"', 0o644);
	await mkdir(join(empty, 'folder'));
	for (const [path, reason] of [
		['deno', /is not an absolute path/],
		[join(empty, 'missing'), /does not exist/],
		[join(empty, 'folder'), /is not a file/],
		[plain, /is not executable/]
	]) {
		await assert.rejects(changes.validate({ 'launch.deno': path }), error => {
			assert.equal(error.status, 422);
			assert.equal(error.body.error.code, 'SETTING_INVALID');
			assert.match(error.body.error.diagnostics[0].message, reason, path);
			return true;
		});
	}
	assert.deepEqual(await changes.validate({ 'launch.deno': null }), { 'launch.deno': null }, 'null sets it back to none');
});

test('the executable receives neither the credentials nor any other variable of the service', async t => {
	const seen = join(await directory(t), 'environment');
	const file = await script(t, `env > "${seen}"\necho "deno 2.0.0"`);
	const environment = { PATH: process.env.PATH, HOME: '/home/someone', BEYOND_HOST_OPTIONS: '{"token":"secret"}', SECRET: 'x' };
	assert.deepEqual(await new Deno({ environment }).check(file), { version: '2.0.0' });
	const names = (await readFile(seen, 'utf8')).split('\n').filter(Boolean).map(line => line.split('=')[0]);
	assert.ok(!names.includes('BEYOND_HOST_OPTIONS') && !names.includes('SECRET'), names.join(', '));
	assert.ok(names.includes('HOME') && names.includes('PATH'));
});
