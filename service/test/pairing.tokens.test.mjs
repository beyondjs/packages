import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pairings } from '../host/pairing/pairings.mjs';

const ORIGIN = 'https://ui.example';

const clock = () => {
	let now = Date.parse('2026-10-10T12:00:00Z');
	const read = () => now;
	read.advance = ms => (now += ms);
	return read;
};

test('a token is 32 random bytes in base64url, bound to the origin that paired, and only its digest is kept', t => {
	const pairings = new Pairings({ clock: clock() });
	t.after(() => pairings.close());
	const { token, expires, pairing } = pairings.issue(ORIGIN);
	assert.match(token, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(Buffer.from(token, 'base64url').length, 32);
	assert.match(pairing.id, /^prg_[0-9a-f]{12}$/);
	assert.equal(pairing.origin, ORIGIN);
	assert.equal(expires, pairing.expires);

	const verified = pairings.verify(token, ORIGIN);
	assert.deepEqual(verified.pairing.id, pairing.id);
	assert.equal(JSON.stringify(pairings.list).includes(token), false, 'the list never holds a token');
	assert.notEqual(pairings.issue(ORIGIN).token, token, 'tokens are random');
});

test('a token presented from another origin is refused with PAIRING_ORIGIN, and stays valid for its own', t => {
	const pairings = new Pairings({ clock: clock() });
	t.after(() => pairings.close());
	const { token } = pairings.issue(ORIGIN);
	for (const origin of ['https://evil.example', 'http://ui.example', undefined]) {
		const { refusal } = pairings.verify(token, origin);
		assert.deepEqual([refusal.status, refusal.code], [403, 'PAIRING_ORIGIN'], String(origin));
	}
	assert.ok(pairings.verify(token, ORIGIN).pairing);
});

test('an unknown or malformed token is PAIRING_REQUIRED', t => {
	const pairings = new Pairings({ clock: clock() });
	t.after(() => pairings.close());
	for (const token of [undefined, '', 'short', 'A'.repeat(43), 7]) {
		const { refusal } = pairings.verify(token, ORIGIN);
		assert.deepEqual([refusal.status, refusal.code], [401, 'PAIRING_REQUIRED'], String(token));
	}
});

test('a pairing idle for its lifetime expires, its token then answered PAIRING_EXPIRED and its observers told', t => {
	const time = clock();
	const pairings = new Pairings({ clock: time, ttl: 60000 });
	t.after(() => pairings.close());
	const { token } = pairings.issue(ORIGIN);
	const reasons = [];
	pairings.verify(token, ORIGIN).observe(reason => reasons.push(reason));

	time.advance(59999);
	assert.ok(pairings.verify(token, ORIGIN).pairing, 'a use within the lifetime renews it');
	time.advance(59999);
	assert.ok(pairings.verify(token, ORIGIN).pairing, 'renewed from its last use');
	time.advance(60000);
	const { refusal } = pairings.verify(token, ORIGIN);
	assert.deepEqual([refusal.status, refusal.code], [401, 'PAIRING_EXPIRED']);
	assert.deepEqual(reasons, ['PAIRING_EXPIRED']);
	assert.deepEqual(pairings.list, []);
});

test('the timer of a pairing ends it when nobody asks', async t => {
	const pairings = new Pairings({ ttl: 50 });
	t.after(() => pairings.close());
	const { token } = pairings.issue(ORIGIN);
	const ended = new Promise(resolve => pairings.verify(token, ORIGIN).observe(resolve));

	// The timer of a pairing does not keep a process alive; the bound of this case does, until it settles
	let timer;
	const bound = new Promise((resolve, reject) => (timer = setTimeout(() => reject(new Error('the pairing did not end within 2 s')), 2000)));
	t.after(() => clearTimeout(timer));
	assert.equal(await Promise.race([ended, bound]), 'PAIRING_EXPIRED');
	assert.equal(pairings.verify(token, ORIGIN).refusal.code, 'PAIRING_EXPIRED');
});

test('a revoked pairing answers PAIRING_REVOKED, one by its identifier or all of them, and its observers are told', t => {
	const pairings = new Pairings({ clock: clock() });
	t.after(() => pairings.close());
	const one = pairings.issue(ORIGIN);
	const two = pairings.issue('http://127.0.0.1:4000');
	const three = pairings.issue(ORIGIN);
	const reasons = [];
	pairings.verify(one.token, ORIGIN).observe(reason => reasons.push(['one', reason]));
	pairings.verify(two.token, 'http://127.0.0.1:4000').observe(reason => reasons.push(['two', reason]));

	assert.equal(pairings.revoke(one.pairing.id), 1);
	assert.equal(pairings.revoke('prg_000000000000'), 0);
	assert.equal(pairings.verify(one.token, ORIGIN).refusal.code, 'PAIRING_REVOKED');
	assert.deepEqual(pairings.list.map(({ id }) => id).sort(), [two.pairing.id, three.pairing.id].sort());

	assert.equal(pairings.revoke(), 2);
	assert.deepEqual(reasons, [['one', 'PAIRING_REVOKED'], ['two', 'PAIRING_REVOKED']]);
	assert.equal(pairings.verify(three.token, ORIGIN).refusal.code, 'PAIRING_REVOKED');
	assert.equal(pairings.names(ORIGIN), false);
});

test('a page ends its own pairing', t => {
	const pairings = new Pairings({ clock: clock() });
	t.after(() => pairings.close());
	const { token } = pairings.issue(ORIGIN);
	const verified = pairings.verify(token, ORIGIN);
	assert.equal(verified.leave(), true);
	assert.equal(verified.leave(), false, 'once');
	assert.equal(pairings.verify(token, ORIGIN).refusal.code, 'PAIRING_REVOKED');
});

test('the list says when each pairing was created, last used and expires', t => {
	const time = clock();
	const pairings = new Pairings({ clock: time });
	t.after(() => pairings.close());
	const { token, pairing } = pairings.issue(ORIGIN);
	time.advance(5000);
	pairings.verify(token, ORIGIN);
	const [listed] = pairings.list;
	assert.deepEqual(Object.keys(listed).sort(), ['created', 'expires', 'id', 'origin', 'used']);
	assert.equal(listed.created, pairing.created);
	assert.equal(Date.parse(listed.used) - Date.parse(listed.created), 5000);
	assert.equal(Date.parse(listed.expires) - Date.parse(listed.used), Pairings.TTL, 'the expiry slides from the last use');
});

test('however often it is used, a pairing ends at its absolute bound from its creation', t => {
	const time = clock();
	const pairings = new Pairings({ clock: time, ttl: 3600000, bound: 4 * 3600000 });
	t.after(() => pairings.close());
	const { token, pairing } = pairings.issue(ORIGIN);
	for (let hour = 1; hour < 4; hour++) {
		time.advance(3600000 - 1);
		const verified = pairings.verify(token, ORIGIN);
		assert.ok(verified.pairing, `hour ${hour}`);
		assert.ok(Date.parse(verified.pairing.expires) <= Date.parse(pairing.created) + 4 * 3600000, 'never past the bound');
	}
	time.advance(3600000);
	assert.equal(pairings.verify(token, ORIGIN).refusal.code, 'PAIRING_EXPIRED');
	assert.equal(Pairings.BOUND, 7 * 86400000, 'seven days by default');
});
