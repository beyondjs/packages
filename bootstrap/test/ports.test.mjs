import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Ports } from '../ports.mjs';

const hold = async port => {
	const server = createServer();
	server.listen(port, '127.0.0.1');
	await once(server, 'listening');
	return server;
};

test('without a range the system chooses a free port', async () => {
	const port = await Ports.free({});
	assert.ok(port > 0 && port < 65536);
});

test('a range gives its first free port, skipping a taken one', async t => {
	const first = await Ports.free({});
	const taken = await hold(first);
	t.after(() => taken.close());
	const port = await Ports.free({ BEYOND_BOOTSTRAP_PORTS: `${first}-${first + 20}` });
	assert.ok(port > first && port <= first + 20);
});

test('a range with no free port is an error, never a port outside it', async t => {
	const first = await Ports.free({});
	const taken = await hold(first);
	t.after(() => taken.close());
	await assert.rejects(Ports.free({ BEYOND_BOOTSTRAP_PORTS: `${first}-${first}` }), /No free port in BEYOND_BOOTSTRAP_PORTS/);
});

test('a malformed range is refused by name', () => {
	for (const value of ['31000', '31999-31000', '0-10', 'a-b', '1-70000']) assert.throws(() => Ports.range(value), /BEYOND_BOOTSTRAP_PORTS must be/);
	assert.deepEqual(Ports.range(' 31800-31999 '), { first: 31800, last: 31999 });
});

test('ports of a range are handed out once each, though nothing listens on them yet', async () => {
	const first = await Ports.free({});
	const range = { BEYOND_BOOTSTRAP_PORTS: `${first}-${first + 30}` };
	const given = [await Ports.free(range), await Ports.free(range), await Ports.free(range)];
	assert.equal(new Set(given).size, 3, 'each project of the bootstrap gets a port of its own');
});

test('a port given back may be taken again by a later start in the same process', async () => {
	// A one-port range no earlier case of this process has handed out
	let range;
	let port;
	for (let attempt = 0; attempt < 20 && !port; attempt++) {
		const first = await Ports.free({});
		range = { BEYOND_BOOTSTRAP_PORTS: `${first}-${first}` };
		port = await Ports.free(range).catch(() => undefined);
	}
	assert.ok(port, 'a one-port range was found');
	await assert.rejects(Ports.free(range), /No free port/);
	Ports.release(port);
	assert.equal(await Ports.free(range), port);
});
