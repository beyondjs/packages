import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Events } from '../host/events.mjs';
import { Services } from '../host/features.mjs';
import { Feature } from '../host/logs/index.mjs';
import { Journal } from '../host/logs/journal.mjs';
import { Caller } from '../host/pairing/caller.mjs';

/**
 * The logs feature mounted on an application of its own, with the caller a policy would leave on each request
 * (`caller` header: `paired`, `local`, `consumer`), the host's events and a stand-in event log of the extension
 */
const serve = async (t, { environment = {} } = {}) => {
	const journal = new Journal();
	const events = new Events();
	const services = new Services();
	const feature = new Feature({ journal, events, services, environment });
	const listeners = new Set();
	feature.follow({ subscribe: listener => (listeners.add(listener), () => listeners.delete(listener)) });
	const app = express();
	app.use((request, response, next) => {
		const kind = request.headers.caller;
		kind && new Caller(kind, kind === 'consumer' ? { refusal: Caller.CREDENTIAL } : {}).attach(request);
		next();
	});
	feature.setup(app);
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => (feature.stop(), new Promise(resolve => (server.closeAllConnections(), server.close(resolve)))));
	const read = async (query = '', caller = 'paired') => {
		const response = await fetch(`http://127.0.0.1:${server.address().port}/logs${query}`, { headers: { caller }, signal: AbortSignal.timeout(5000) });
		return { status: response.status, headers: response.headers, body: await response.json() };
	};
	const extension = event => listeners.forEach(listener => listener(event));
	return { journal, events, services, feature, read, extension };
};

test('the journal keeps the last entries with cursors that only grow, one line each', () => {
	const journal = new Journal({ clock: () => Date.parse('2026-10-17T10:00:00Z') });
	for (let index = 1; index <= Journal.LIMIT + 5; index++) journal.add('info', 'service', `line ${index}`);
	const { entries, cursor } = journal.read({ after: 0, limit: 3 });
	assert.deepEqual(entries.map(({ cursor }) => cursor), [6, 7, 8], 'the oldest were forgotten');
	assert.equal(cursor, 8);
	assert.deepEqual(journal.read({ after: Journal.LIMIT + 5 }), { entries: [], cursor: Journal.LIMIT + 5 });

	const entry = journal.add('loud', 'service', 'two\nlines \u001b[31mred\u001b[0m');
	assert.deepEqual(entry, { cursor: Journal.LIMIT + 6, at: '2026-10-17T10:00:00.000Z', level: 'info', source: 'service', message: 'two lines red' });
});

test('builds, launches, reloads and settings are logged, and read after a cursor with a bounded limit', async t => {
	const { journal, events, read, extension, services, feature } = await serve(t);
	assert.equal(services.get('logs'), feature);
	assert.deepEqual(feature.capabilities, { logs: 1 });

	extension({ type: 'build.ended', build: { state: 'failed', diagnostics: [{ code: 'TS1005', message: "'>' expected", file: 'web/home/view.tsx', range: { line: 16, column: 3 } }] } });
	extension({ type: 'build.ended', build: { state: 'completed' } });
	extension({ type: 'launch.output', launch: {} });
	events.emit('launch.changed', { launch: { id: 'lch_1', application: 'composition', target: 'api', state: 'running' } });
	events.emit('launch.changed', { launch: { id: 'lch_1', application: 'composition', target: 'api', state: 'failed', failure: { code: 'PORT_IN_USE', message: 'Port 5231 is already in use' } } });
	events.emit('workspace.changed', { reloads: 2 });
	events.emit('settings.changed', { revision: 'sha256-1' });
	journal.add('warn', 'service', 'warning: something');

	const { status, headers, body } = await read();
	assert.equal(status, 200);
	assert.equal(headers.get('cache-control'), 'no-store');
	assert.deepEqual(body.entries.map(({ level, source, message }) => [level, source, message]), [
		['error', 'build', "The build failed with 1 problem. web/home/view.tsx:16:3: '>' expected"],
		['info', 'build', 'The build compiled'],
		['info', 'launch:lch_1', 'composition/api started'],
		['error', 'launch:lch_1', 'composition/api failed: Port 5231 is already in use'],
		['info', 'service', 'The declarations of the workspace changed and were read again'],
		['info', 'service', 'The settings changed'],
		['warn', 'service', 'warning: something']
	]);
	assert.equal(body.cursor, 7);
	assert.deepEqual((await read('?after=5&limit=1')).body.entries.map(({ cursor }) => cursor), [6]);
	assert.deepEqual((await read('?after=x&limit=99999')).body.entries.length, 7, 'invalid values read as their defaults, the limit bounded');
});

test('only a paired page and a local tool read the log; a service of delegated grants has none', async t => {
	const { read } = await serve(t);
	assert.equal((await read('', 'local')).status, 200);
	const refused = await read('', 'consumer');
	assert.deepEqual([refused.status, refused.body.error.code], [401, 'CREDENTIAL_REQUIRED']);

	const delegated = await serve(t, { environment: { BEYOND_AUTHORITY: '{}' } });
	assert.deepEqual(delegated.feature.capabilities, {});
	assert.equal(delegated.services.get('logs'), undefined);
});
