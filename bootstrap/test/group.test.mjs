import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { Group } from '../group.mjs';
import { Ports } from '../ports.mjs';

const alive = pid => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

// A parent that starts a worker and reports its pid, as the bootstrap servers do with their forks
const parent = `
	const { spawn } = require('node:child_process');
	const worker = spawn(process.execPath, ['-e', 'setInterval(() => 0, 1000)'], { stdio: 'ignore' });
	console.log(worker.pid);
	setInterval(() => 0, 1000);
`;

test('stopping a group ends the process and what it started', { skip: process.platform === 'win32' }, async () => {
	const child = spawn(process.execPath, ['-e', parent], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
	const group = new Group(child);

	const [output] = await once(child.stdout, 'data');
	const worker = Number(output.toString().trim());
	assert.ok(group.running && alive(worker));

	await group.stop(2000);
	for (let attempt = 0; attempt < 20 && alive(worker); attempt++) await sleep(50);

	assert.equal(alive(worker), false);
	assert.equal(group.running, false);
});

test('stopping a group that already ended does nothing', async () => {
	const child = spawn(process.execPath, ['-e', ''], { detached: true, stdio: 'ignore' });
	await once(child, 'exit');
	await new Group(child).stop(200);
});

test('a free port is reported', async () => {
	const port = await Ports.free();
	assert.ok(Number.isInteger(port) && port > 0);
});
