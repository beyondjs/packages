import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Generations } from '../host/generations.mjs';
import { Sequence } from './support/workspaces.mjs';

const DEADLINE = 60;

const generations = sequence => new Generations(() => sequence.create(), { deadline: DEADLINE });

test('an explicit reload replaces the served generation although no manifest changed', async () => {
	const sequence = new Sequence(['ready', 'ready']);
	const hosted = generations(sequence);
	await hosted.start();

	await hosted.reload('the installation wrote the projection');
	assert.equal(hosted.current, sequence.created[1]);
	assert.equal(hosted.reloads, 1);
});

test('a reload in progress that fails does not stand for an explicit reload: it gets one of its own', async () => {
	// The reload in progress started before the installation wrote its files, and fails
	const sequence = new Sequence(['ready', 'failing', 'ready']);
	const hosted = generations(sequence);
	await hosted.start();

	hosted.invalidate();
	const pending = hosted.refresh().catch(error => error);
	await hosted.reload('the installation wrote the projection');

	assert.equal((await pending)?.code, 'READ_FAILED', 'the request that started it is told how it ended');
	assert.equal(sequence.created.length, 3);
	assert.equal(hosted.current, sequence.created[2], 'the generation created for the explicit reload is served');
});

test('a reload in progress that succeeds still does not stand for an explicit reload asked during it', async () => {
	// It may have read the files before the installation wrote them
	const sequence = new Sequence(['ready', 'ready', 'ready']);
	const hosted = generations(sequence);
	await hosted.start();

	hosted.invalidate();
	const pending = hosted.refresh();
	await hosted.reload('the installation wrote the projection');
	await pending;

	assert.equal(sequence.created.length, 3);
	assert.equal(hosted.current, sequence.created[2]);
	assert.equal(hosted.reloads, 2);
});

test('an explicit reload that does not settle is answered as unavailable, and the previous generation is served', async () => {
	const sequence = new Sequence(['ready', 'stalled', 'ready']);
	const hosted = generations(sequence);
	await hosted.start();
	const [first] = sequence.created;

	await assert.rejects(hosted.reload('the installation wrote the projection'), { code: 'UNAVAILABLE' });
	assert.equal(hosted.current, first);

	// The next request tries again
	await hosted.refresh();
	assert.equal(hosted.current, sequence.created[2]);
});
