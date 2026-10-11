import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Codes } from '../host/pairing/codes.mjs';

/**
 * A clock the case moves by hand, in milliseconds
 */
const clock = () => {
	let now = Date.parse('2026-10-10T12:00:00Z');
	const read = () => now;
	read.advance = ms => (now += ms);
	return read;
};

test('a code is 8 Crockford base-32 characters shown as XXXX-XXXX, valid for ten minutes', () => {
	const time = clock();
	const codes = new Codes({ clock: time });
	const seen = new Set();
	for (let index = 0; index < 50; index++) {
		const { code, expires, origins } = codes.create();
		assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
		assert.equal(Date.parse(expires) - time(), Codes.LIFETIME);
		assert.deepEqual(origins, []);
		seen.add(code);
	}
	assert.equal(seen.size, 50, 'codes are random');
	assert.equal(codes.size, Codes.LIMIT, 'at most five are outstanding');
});

test('a code is typed as the person reads it: case, spaces and the hyphen do not matter, I L O read as 1 1 0', () => {
	assert.equal(Codes.normalize('7kq2-mx9d'), '7KQ2MX9D');
	assert.equal(Codes.normalize(' 7kq2 mx9d '), '7KQ2MX9D');
	assert.equal(Codes.normalize('ILO0-1234'), '11001234');
	for (const value of ['7KQ2-MX9', '7KQ2-MX9DE', 'UUUU-UUUU', '', 7, undefined, 'x'.repeat(64)]) assert.equal(Codes.normalize(value), undefined, String(value));
});

test('a code is valid once', () => {
	const codes = new Codes({ clock: clock() });
	const { code } = codes.create({ origins: ['https://ui.example'] });
	const first = codes.redeem(code.toLowerCase());
	assert.deepEqual(first, { origins: ['https://ui.example'] });
	const again = codes.redeem(code);
	assert.equal(again.refusal.status, 401);
	assert.equal(again.refusal.code, 'PAIRING_CODE_INVALID');
});

test('a code expires after ten minutes', () => {
	const time = clock();
	const codes = new Codes({ clock: time });
	const { code } = codes.create();
	time.advance(Codes.LIFETIME - 1);
	const fresh = codes.create();
	time.advance(1);
	assert.equal(codes.redeem(code).refusal.code, 'PAIRING_CODE_INVALID', 'expired');
	assert.deepEqual(codes.redeem(fresh.code), { origins: [] }, 'a later code is still valid');
});

test('five wrong attempts end every code outstanding while they were made, and answer 429 until a new code', () => {
	const codes = new Codes({ clock: clock() });
	const { code } = codes.create();
	for (let attempt = 1; attempt < Codes.ATTEMPTS; attempt++) {
		const { refusal } = codes.redeem('ZZZZ-ZZZZ');
		assert.deepEqual([refusal.status, refusal.code], [401, 'PAIRING_CODE_INVALID'], `attempt ${attempt}`);
	}
	const fifth = codes.redeem('ZZZZ-ZZZZ');
	assert.deepEqual([fifth.refusal.status, fifth.refusal.code], [429, 'PAIRING_ATTEMPTS']);
	assert.equal(codes.size, 0);

	// The right code no longer works, and every attempt says why until a new code is created
	assert.equal(codes.redeem(code).refusal.code, 'PAIRING_ATTEMPTS');
	const renewed = codes.create();
	assert.deepEqual(codes.redeem(renewed.code), { origins: [] });
});

test('a wrong attempt counts against the codes outstanding when it is made, not against later ones', () => {
	const codes = new Codes({ clock: clock() });
	const early = codes.create();
	for (let attempt = 0; attempt < 3; attempt++) codes.redeem('ZZZZ-ZZZZ');
	const late = codes.create();
	codes.redeem('ZZZZ-ZZZZ');
	const ended = codes.redeem('ZZZZ-ZZZZ');
	assert.equal(ended.refusal.code, 'PAIRING_ATTEMPTS', 'the fifth wrong attempt ended the early code');
	assert.equal(codes.redeem(early.code).refusal.code, 'PAIRING_CODE_INVALID');
	assert.deepEqual(codes.redeem(late.code), { origins: [] }, 'the late code saw two wrong attempts');
});

test('at most five codes are outstanding: a sixth replaces the oldest', () => {
	const codes = new Codes({ clock: clock() });
	const created = Array.from({ length: 6 }, () => codes.create().code);
	assert.equal(codes.size, 5);
	assert.equal(codes.redeem(created[0]).refusal.code, 'PAIRING_CODE_INVALID', 'the oldest was replaced');
	for (const code of created.slice(1)) assert.deepEqual(codes.redeem(code), { origins: [] });
});

test('a code the origin of the request may not redeem is refused and stays outstanding', () => {
	const codes = new Codes({ clock: clock() });
	const { code } = codes.create({ origins: ['https://ui.example'] });
	const refused = codes.redeem(code, origins => origins.has('https://other.example'));
	assert.deepEqual([refused.refusal.status, refused.refusal.code], [403, 'PAIRING_ORIGIN']);
	assert.ok(codes.names('https://ui.example'));
	assert.deepEqual(codes.redeem(code, origins => origins.has('https://ui.example')), { origins: ['https://ui.example'] });
	assert.ok(!codes.names('https://ui.example'), 'a used code names nobody');
});
