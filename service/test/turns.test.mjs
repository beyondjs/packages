import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Holds } from '../host/holds.mjs';
import { Installer } from '../host/installer.mjs';
import { Turns } from '../host/turns.mjs';
import { Stand } from './support/installation.mjs';
import { mount } from './support/routes.mjs';

/**
 * Waits for a condition, which may be asynchronous, failing instead of hanging when it does not arrive
 */
const until = async (condition, what, limit = 5000) => {
	const deadline = Date.now() + limit;
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise(resolve => setTimeout(resolve, 5));
	}
};

test('turns are given one at a time, in the order they were asked for', async () => {
	const turns = new Turns();
	const order = [];

	assert.equal(await turns.take(1000), true);
	assert.equal(turns.running, true);
	const second = turns.take(1000).then(given => order.push(['second', given]));
	const third = turns.take(1000).then(given => order.push(['third', given]));
	assert.equal(turns.queued, 2);

	turns.release();
	await second;
	assert.equal(turns.queued, 1);
	turns.release();
	await third;
	turns.release();

	assert.deepEqual(order, [['second', true], ['third', true]]);
	assert.equal(turns.running, false);
	assert.equal(turns.queued, 0);
});

test('a request that does not get its turn within its bound gives up and never gets one', async () => {
	const turns = new Turns();
	await turns.take(1000);

	const started = Date.now();
	assert.equal(await turns.take(80), false);
	assert.ok(Date.now() - started >= 80);
	assert.equal(turns.queued, 0, 'it left the queue');

	turns.release();
	assert.equal(turns.running, false, 'the turn it gave up is not given to it later');
});

test('the installation says whether one runs and how many wait, and one that waits too long is not started', async t => {
	const stand = new Stand({ projection: 'missing', held: true });
	const { post, get } = await mount(t, stand, { queue: 150 });

	const first = post('{}');
	await stand.started(1);
	const waiting = post('{"update":true}');
	await until(async () => (await get()).queued === 1, 'the second request to wait');
	const described = await get();
	assert.equal(described.running, true);
	assert.equal(described.queued, 1);

	const refused = await waiting;
	assert.equal(refused.status, 503);
	assert.equal(refused.body.error.code, 'UNAVAILABLE');
	assert.match(refused.body.error.message, /in progress and did not end within 150ms, so this one was not started/);
	assert.match(refused.body.error.message, /BEYOND_INSTALL_QUEUE_TIMEOUT/);

	stand.release();
	assert.equal((await first).status, 200);
	assert.equal(stand.installations.length, 1, 'the one that gave up never ran');
	const after = await get();
	assert.equal(after.running, false);
	assert.equal(after.queued, 0);
});

test('an installation holds the service while it runs, within its deadline and a grace, and gets that deadline', async t => {
	const holds = new Holds();
	const stand = new Stand({ projection: 'missing', held: true });
	const { post } = await mount(t, stand, { holds, deadline: 45000 });

	const answer = post('{}');
	await stand.started(1);
	assert.equal(holds.size, 1, 'the running installation holds the service');
	assert.equal(stand.installations[0].params.deadline, 45000, 'the installation is bounded by the same deadline');

	stand.release();
	assert.equal((await answer).status, 200);
	assert.equal(holds.size, 0, 'it holds nothing once it ended');
	assert.equal(Installer.DEADLINE, 540000);
	assert.ok(Installer.GRACE > 0);
});
