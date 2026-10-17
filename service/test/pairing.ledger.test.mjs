import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../host/pairing/ledger.mjs';
import { Pairings } from '../host/pairing/pairings.mjs';

const ORIGIN = 'https://ui.example';
const posix = typeof process.getuid === 'function';

const clock = () => {
	let now = Date.parse('2026-10-10T12:00:00Z');
	const read = () => now;
	read.advance = ms => (now += ms);
	return read;
};

const workspace = t => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'beyond pairings ')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
};

/**
 * A service of the workspace, as one start of it keeps its pairings: closed when the case ends
 */
const start = (t, root, options = {}) => {
	const reports = [];
	const pairings = new Pairings({ ledger: new Ledger(root, options), report: message => reports.push(message), ...options });
	const problem = pairings.load();
	t.after(() => pairings.close());
	return { pairings, problem, reports };
};

test('a service started again on the same workspace knows its pairings, kept as hashes in a file only its user reads', t => {
	const root = workspace(t);
	const time = clock();
	const first = start(t, root, { clock: time });
	const { token, pairing } = first.pairings.issue(ORIGIN, { snapshots: 'http://snapshots.beyond.localhost:5300' });
	first.pairings.close();

	const file = join(root, '.beyond', 'pairings.json');
	const text = readFileSync(file, 'utf8');
	assert.equal(text.includes(token), false, 'never the token');
	assert.match(text, /"hash": "[0-9a-f]{64}"/);
	posix && assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.equal(readFileSync(join(root, '.beyond', '.gitignore'), 'utf8'), '*\n');

	time.advance(60000);
	const second = start(t, root, { clock: time });
	assert.equal(second.problem, undefined);
	const verified = second.pairings.verify(token, ORIGIN);
	assert.equal(verified.pairing.id, pairing.id, 'the same pairing');
	assert.equal(verified.snapshots, 'http://snapshots.beyond.localhost:5300', 'with the Snapshots origin it declared');
	assert.equal(second.pairings.verify(token, 'https://evil.example').refusal.code, 'PAIRING_ORIGIN', 'still bound to its origin');
});

test('a revoked pairing is removed from the file, and its token is unknown to the next start', t => {
	const root = workspace(t);
	const first = start(t, root);
	const kept = first.pairings.issue(ORIGIN);
	const revoked = first.pairings.issue(ORIGIN);
	assert.equal(first.pairings.revoke(revoked.pairing.id), 1);
	const listed = JSON.parse(readFileSync(join(root, '.beyond', 'pairings.json'), 'utf8')).pairings.map(({ id }) => id);
	assert.deepEqual(listed, [kept.pairing.id]);
	first.pairings.close();

	const second = start(t, root);
	assert.equal(second.pairings.verify(revoked.token, ORIGIN).refusal.code, 'PAIRING_REQUIRED');
	assert.ok(second.pairings.verify(kept.token, ORIGIN).pairing);
	assert.equal(second.pairings.revoke(), 1);
	assert.equal(existsSync(join(root, '.beyond', 'pairings.json')), false, 'no pairing, no file');
});

test('a pairing idle past its lifetime, or past its absolute bound, is not kept by the next start and leaves the file', t => {
	const root = workspace(t);
	const time = clock();
	const first = start(t, root, { clock: time, ttl: 3600000, bound: 4 * 3600000 });
	const idle = first.pairings.issue(ORIGIN);
	const busy = first.pairings.issue(ORIGIN);
	for (let step = 0; step < 3; step++) {
		time.advance(3600000 - 1000);
		assert.ok(first.pairings.verify(busy.token, ORIGIN).pairing, 'renewed while used');
	}
	first.pairings.close();

	const second = start(t, root, { clock: time, ttl: 3600000, bound: 4 * 3600000 });
	assert.equal(second.pairings.verify(idle.token, ORIGIN).refusal.code, 'PAIRING_REQUIRED', 'idle for more than its lifetime');
	assert.ok(second.pairings.verify(busy.token, ORIGIN).pairing, 'used within its lifetime');
	second.pairings.close();

	time.advance(3 * 3600000);
	const third = start(t, root, { clock: time, ttl: 3600000, bound: 4 * 3600000 });
	assert.equal(third.pairings.verify(busy.token, ORIGIN).refusal.code, 'PAIRING_REQUIRED', 'past its absolute bound');
	assert.equal(existsSync(join(root, '.beyond', 'pairings.json')), false, 'the expired ones were removed');
});

test('a pairings file the service did not write is ignored with a diagnostic, and the next pairing replaces it', async t => {
	const valid = root => {
		const first = start(t, root);
		const issued = first.pairings.issue(ORIGIN);
		first.pairings.close();
		return issued;
	};

	await t.test('readable by other users', t => {
		if (!posix) return t.skip('modes are POSIX');
		const root = workspace(t);
		const { token } = valid(root);
		chmodSync(join(root, '.beyond', 'pairings.json'), 0o644);
		const { pairings, problem } = start(t, root);
		assert.equal(problem.code, 'PAIRINGS_FILE_UNTRUSTED');
		assert.match(problem.message, /can be read or written by other users/);
		assert.equal(pairings.verify(token, ORIGIN).refusal.code, 'PAIRING_REQUIRED');
		pairings.issue(ORIGIN);
		assert.equal(statSync(join(root, '.beyond', 'pairings.json')).mode & 0o777, 0o600, 'replaced by one it wrote');
	});

	await t.test('a symbolic link', t => {
		const root = workspace(t);
		const elsewhere = workspace(t);
		const { token } = valid(elsewhere);
		mkdirSync(join(root, '.beyond'), { recursive: true });
		symlinkSync(join(elsewhere, '.beyond', 'pairings.json'), join(root, '.beyond', 'pairings.json'));
		const { pairings, problem } = start(t, root);
		assert.equal(problem.code, 'PAIRINGS_FILE_UNTRUSTED');
		assert.match(problem.message, /symbolic link/);
		assert.equal(pairings.verify(token, ORIGIN).refusal.code, 'PAIRING_REQUIRED');
	});

	await t.test('owned by another user', t => {
		if (!posix) return t.skip('owners are POSIX');
		const root = workspace(t);
		const { token } = valid(root);
		const { pairings, problem } = start(t, root, { identity: { getuid: () => process.getuid() + 1 } });
		assert.equal(problem.code, 'PAIRINGS_FILE_UNTRUSTED');
		assert.match(problem.message, /another user/);
		assert.equal(pairings.verify(token, ORIGIN).refusal.code, 'PAIRING_REQUIRED');
	});

	await t.test('not a pairings document', t => {
		const root = workspace(t);
		mkdirSync(join(root, '.beyond'), { recursive: true });
		writeFileSync(join(root, '.beyond', 'pairings.json'), '{"pairings": 7}', { mode: 0o600 });
		const { problem } = start(t, root);
		assert.equal(problem.code, 'PAIRINGS_FILE_INVALID');
	});
});

test('a file that cannot be written is reported, and the pairing still works until the service stops', t => {
	const root = workspace(t);
	writeFileSync(join(root, '.beyond'), 'not a directory');
	const { pairings, reports } = start(t, root);
	const { token } = pairings.issue(ORIGIN);
	assert.ok(pairings.verify(token, ORIGIN).pairing);
	assert.match(reports[0], /could not be written/);
});
