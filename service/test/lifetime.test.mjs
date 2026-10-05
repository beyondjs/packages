import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Holds } from '../host/holds.mjs';
import { Lifetime } from '../host/lifetime.mjs';

/**
 * Who is attached to a service, as `Lifetime` reads it: the number of attachments, whether its owner is one of them,
 * and the events of attaching and detaching, which the case causes
 */
class Clients {
	#kinds = [];
	#listeners = new Set();

	get size() {
		return this.#kinds.length;
	}

	get owned() {
		return this.#kinds.includes('owner');
	}

	observe(listener) {
		this.#listeners.add(listener);
	}

	attach(kind) {
		this.#kinds.push(kind);
		this.#listeners.forEach(listener => listener({ type: 'attached', kind }));
	}

	detach(kind) {
		this.#kinds.splice(this.#kinds.indexOf(kind), 1);
		this.#listeners.forEach(listener => listener({ type: 'detached', kind }));
	}
}

/**
 * A lifetime with short bounds, the clients and the holds it decides from, and how it ended
 */
const service = (t, mode, { idle = 40, unclaimed = 10000 } = {}) => {
	const previous = { IDLE: Lifetime.IDLE, UNCLAIMED: Lifetime.UNCLAIMED };
	Object.assign(Lifetime, { IDLE: idle, UNCLAIMED: unclaimed });
	t.after(() => Object.assign(Lifetime, previous));

	const clients = new Clients();
	const holds = new Holds();
	let reason;
	const ended = new Promise(resolve => new Lifetime(mode, clients, value => resolve((reason = value)), holds).start());
	return { clients, holds, ended, reason: () => reason };
};

/**
 * Work the case ends
 */
const work = () => {
	let end;
	const promise = new Promise(resolve => (end = resolve));
	return { promise, end };
};

/**
 * Waits for a promise, failing instead of hanging when it does not settle
 */
const within = async (promise, ms, what) => {
	let timer;
	const expired = new Promise((resolve, reject) => (timer = setTimeout(() => reject(new Error(`Expected ${what} within ${ms} ms`)), ms)));
	try {
		return await Promise.race([promise, expired]);
	} finally {
		clearTimeout(timer);
	}
};

test('an installation that runs keeps a service that ends with its clients, which ends shortly after it', async t => {
	const { clients, holds, ended, reason } = service(t, 'attachments');
	clients.attach('consumer');
	const installing = work();
	const held = holds.run(() => installing.promise, 10000);

	// The command that asked for it was interrupted: its client is gone, the installation is not
	clients.detach('consumer');
	await sleep(160);
	assert.equal(reason(), undefined, 'not ended while the installation runs');

	installing.end('report');
	assert.equal(await held, 'report');
	assert.match(await within(ended, 1000, 'the service ends'), /the work that held the service ended, and nobody is attached/);
});

test('work that does not settle holds the service only within its bound', async t => {
	const { clients, holds, ended, reason } = service(t, 'attachments');
	clients.attach('consumer');
	void holds.run(() => new Promise(() => void 0), 150);
	clients.detach('consumer');

	await sleep(100);
	assert.equal(reason(), undefined, 'held');
	assert.match(await within(ended, 1000, 'the service ends after the bound'), /nobody is attached/);
	assert.equal(holds.size, 0);
});

test('a client attached when the work ends keeps the service, which ends after that client detaches', async t => {
	const { clients, holds, ended, reason } = service(t, 'attachments');
	clients.attach('consumer');
	const installing = work();
	const held = holds.run(() => installing.promise, 10000);

	installing.end();
	await held;
	await sleep(160);
	assert.equal(reason(), undefined, 'a client is attached');

	clients.detach('consumer');
	assert.match(await within(ended, 1000, 'the service ends'), /the last client detached/);
});

test('a service nobody attached to keeps running while an installation runs, and ends after it', async t => {
	const { holds, ended, reason } = service(t, 'attachments', { unclaimed: 60 });
	const installing = work();
	const held = holds.run(() => installing.promise, 10000);

	await sleep(200);
	assert.equal(reason(), undefined, 'the installation claims it');
	installing.end();
	await held;
	assert.match(await within(ended, 1000, 'the service ends'), /nobody is attached/);
});

test('an owned service ends when its owner detaches, whatever runs', async t => {
	const { clients, holds, ended } = service(t, 'owner');
	clients.attach('owner');
	void holds.run(() => new Promise(() => void 0), 10000);

	clients.detach('owner');
	assert.equal(await within(ended, 1000, 'the service ends'), 'the session that owns the service ended');
});

test('work that rejects stops holding the service as well', async t => {
	const { holds } = service(t, 'attachments');
	const failure = holds.run(async () => {
		throw Object.assign(new Error('the installation failed'), { code: 'INSTALLATION_FAILED' });
	}, 10000);

	await assert.rejects(failure, { code: 'INSTALLATION_FAILED' });
	assert.equal(holds.size, 0);
});
