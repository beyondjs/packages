import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loopback } from '../host/exports/loopback.mjs';
import { Transfer } from '../host/exports/transfer.mjs';
import { Exports } from '../host/exports/exports.mjs';

const ask = (hostname, options) =>
	new Promise((resolve, reject) => Loopback.lookup(hostname, options, (error, address, family) => (error ? reject(error) : resolve(options?.all ? address : { address, family }))));

test('localhost and every name under it are loopback names, and nothing else that only resembles them', () => {
	for (const name of ['127.0.0.1', '[::1]', 'localhost', 'snapshots.beyond.localhost', 'a.b.c.localhost', 'localhost.', 'Snapshots.Localhost']) {
		assert.equal(Loopback.is(name), true, name);
	}
	for (const name of ['localhost.example', 'snapshots.localhost.example.com', 'notlocalhost', 'evil-localhost', '127.0.0.2', '10.0.0.1', 'example.com', '']) {
		assert.equal(Loopback.is(name), false, name);
	}
});

test('a name under localhost connects to 127.0.0.1 without asking the resolver, in both forms a connection asks', async () => {
	// The system resolver may answer ::1 first or only; the suite's services listen on 127.0.0.1
	assert.deepEqual(await ask('snapshots.beyond.localhost', { all: true }), [{ address: '127.0.0.1', family: 4 }]);
	assert.deepEqual(await ask('snapshots.beyond.localhost', {}), { address: '127.0.0.1', family: 4 });
	assert.deepEqual(await ask('localhost', { all: true }), [{ address: '127.0.0.1', family: 4 }]);
	const short = await new Promise(resolve => Loopback.lookup('snapshots.beyond.localhost', (error, address, family) => resolve({ error, address, family })));
	assert.deepEqual(short, { error: null, address: '127.0.0.1', family: 4 });

	// Any other name is the system's answer
	assert.deepEqual(await ask('127.0.0.1', {}), { address: '127.0.0.1', family: 4 });
	await assert.rejects(ask('missing.invalid', {}), error => ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME'].includes(error.code));
});

test('http is allowed only on a loopback name, for a Snapshots origin and an upload address', () => {
	assert.deepEqual(Exports.origins({ BEYOND_SNAPSHOTS_ORIGINS: 'http://snapshots.beyond.localhost:4310, https://snapshots.example' }), [
		'http://snapshots.beyond.localhost:4310',
		'https://snapshots.example'
	]);
	for (const value of ['http://snapshots.example', 'http://localhost.example:4310', 'http://192.168.1.20:4310']) {
		assert.throws(() => Exports.origins({ BEYOND_SNAPSHOTS_ORIGINS: value }), /neither an https origin nor an http one on a loopback name/, value);
	}
	assert.equal(Transfer.secure(new URL('http://snapshots.beyond.localhost:4310/v1/captures/x/archive?package=.')), true);
	assert.equal(Transfer.secure(new URL('http://snapshots.localhost.example:4310/')), false);
	assert.equal(Transfer.secure(new URL('ftp://localhost/')), false);
});
