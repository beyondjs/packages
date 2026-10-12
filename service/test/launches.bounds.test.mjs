import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Launches } from '../host/launches/launches.mjs';

/**
 * The waits of the launches registry end: a catalog that never answers is answered as unavailable within the bound of a
 * resolution, and the target's later requests are decided instead of queueing behind it forever
 */

const silent = { kind: 'backend', specifier: 'x/y' };

/**
 * A command that runs nothing: a launch of it fails at once
 */
const command = { of: async () => ({ executable: '/no/such/executable', args: [], cwd: '/', env: {} }) };

/**
 * A command whose process lives until it is stopped
 */
const living = { of: async () => ({ executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: tmpdir(), env: {} }) };

test('a catalog that never answers is answered as unavailable within the bound, and frees the target', async () => {
	let answer = () => new Promise(() => void 0);
	const catalog = { resolve: () => answer() };
	const launches = new Launches({ catalog: () => catalog, command, bound: 1000, resolution: 200 });

	const started = Date.now();
	await assert.rejects(launches.create({ application: 'a', target: 'b' }, 'request-0001'), { code: 'UNAVAILABLE', status: 503 });
	const elapsed = Date.now() - started;
	assert.ok(elapsed >= 190 && elapsed < 2000, `answered in ${elapsed}ms`);

	// The same identifier, and the target, are decided again once the catalog answers
	answer = () => Promise.resolve(silent);
	const { launch, created } = await launches.create({ application: 'a', target: 'b' }, 'request-0001');
	assert.equal(created, true);
	await launch.ended;
	assert.equal(launch.state, 'failed', 'the stand-in command names no executable');
	assert.deepEqual([launch.toJSON().reason.code, launch.toJSON().pid], ['LAUNCH_SPAWN_FAILED', null], 'an executable that cannot be started fails without a process');
	assert.deepEqual(launches.list().map(one => one.id), [launch.id]);
});

test('a request that waits for another one of its target is answered once that one is decided', async t => {
	let release;
	const first = new Promise(resolve => (release = resolve));
	let calls = 0;
	const catalog = { resolve: () => (++calls === 1 ? first : Promise.resolve(silent)) };
	const launches = new Launches({ catalog: () => catalog, command: living, bound: 1000, resolution: 5000 });
	t.after(() => launches.end({ grace: 1000 }));

	const one = launches.create({ application: 'a', target: 'b' }, 'request-0001');
	const two = launches.create({ application: 'a', target: 'b' }, 'request-0002');
	const same = launches.create({ application: 'a', target: 'b' }, 'request-0001');
	release(silent);
	const [created, refused, repeated] = await Promise.allSettled([one, two, same]);
	assert.equal(created.status, 'fulfilled');
	assert.equal(repeated.value.launch, created.value.launch, 'the repeated identifier waited for the launch it named');
	assert.equal(repeated.value.created, false);
	assert.equal(refused.reason.code, 'LAUNCH_RUNNING', 'the second request was decided after the first had started its process');
	assert.equal(refused.reason.details.launch.id, created.value.launch.id);
	assert.equal(calls, 1, 'the refused request never reached the catalog');
});

test('the ended launches kept are the latest ones, with the identifiers that named them', async () => {
	const catalog = { resolve: async () => silent };
	const launches = new Launches({ catalog: () => catalog, command, bound: 1000, resolution: 5000 });
	const ids = [];
	for (let index = 0; index < Launches.RETAINED + 3; index++) {
		const { launch } = await launches.create({ application: 'a', target: 'b' }, `request-${String(index).padStart(4, '0')}`);
		await launch.ended;
		ids.push(launch.id);
	}
	const kept = launches.list().map(one => one.id);
	assert.equal(kept.length, Launches.RETAINED + 1, 'the one just created is kept beside the retained ones');
	assert.deepEqual(kept, ids.slice(-kept.length).reverse());
	assert.throws(() => launches.get(ids[0]), { code: 'LAUNCH_NOT_FOUND' });

	// The identifier of a forgotten launch names nothing any more: it launches again
	const { created } = await launches.create({ application: 'a', target: 'b' }, 'request-0000');
	assert.equal(created, true);
});

test('a request whose target is resolved after the end began starts no process, and a request after it is unavailable', async t => {
	let release;
	const pending = new Promise(resolve => (release = resolve));
	const catalog = { resolve: () => pending };
	const launches = new Launches({ catalog: () => catalog, command: living, bound: 1000, resolution: 5000 });
	t.after(() => launches.kill());

	const created = launches.create({ application: 'a', target: 'b' }, 'request-0001');
	const queued = launches.create({ application: 'a', target: 'b' }, 'request-0002');
	const ending = launches.end({ grace: 200, settle: 200 });
	release(silent);
	await assert.rejects(created, { code: 'UNAVAILABLE', status: 503, message: /ending/ });
	await assert.rejects(queued, { code: 'UNAVAILABLE', status: 503 }, 'a request waiting for its turn is decided as ending too');
	await ending;
	assert.deepEqual(launches.list(), [], 'no launch was created, so no process was started');
	assert.equal(launches.alive, false);

	await assert.rejects(launches.create({ application: 'a', target: 'b' }, 'request-0003'), { code: 'UNAVAILABLE', status: 503 });
	assert.deepEqual(launches.list(), []);
});

test('the end stops what lives, waits for it, and leaves no process the registry may signal', async t => {
	const catalog = { resolve: async () => silent };
	const launches = new Launches({ catalog: () => catalog, command: living, bound: 1000, resolution: 5000 });
	t.after(() => launches.kill());
	const { launch } = await launches.create({ application: 'a', target: 'b' }, 'request-0001');
	const { pid } = launch.toJSON();
	assert.ok(Number.isInteger(pid));
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(launches.alive, true, 'its group holds its process');

	await launches.end({ grace: 500, settle: 1000 });
	await launches.settled();
	assert.equal(launches.alive, false);
	assert.equal(launch.state, 'exited');
	assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
