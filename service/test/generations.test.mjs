import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Generations } from '../host/generations.mjs';
import { Sequence } from './support/workspaces.mjs';

const DEADLINE = 60;

const generations = sequence => new Generations(() => sequence.create(), { deadline: DEADLINE });

test('a workspace that is never read fails the start, named and within the bound', async () => {
	const sequence = new Sequence(['stalled']);
	const failure = await generations(sequence).start().then(
		() => undefined,
		error => error
	);

	assert.equal(failure?.code, 'WORKSPACE_NOT_READY');
	assert.match(failure.message, new RegExp(`not read within ${DEADLINE}ms`));
	assert.match(failure.message, /BEYOND_WORKSPACE_TIMEOUT/);
	assert.equal(sequence.created[0].destroyed, true, 'the workspace that was not read is destroyed');
});

test('a reload that never becomes ready is answered as unavailable, and the previous workspace keeps being served', async () => {
	const sequence = new Sequence(['ready', 'stalled']);
	const hosted = generations(sequence);
	await hosted.start();
	const [first] = sequence.created;

	hosted.invalidate();
	const failure = await hosted.refresh().then(
		() => undefined,
		error => error
	);

	assert.equal(failure?.name, 'ContractError');
	assert.equal(failure.code, 'UNAVAILABLE');
	assert.equal(failure.status, 503);
	assert.match(failure.message, /being reloaded/);
	assert.match(failure.message, /BEYOND_WORKSPACE_TIMEOUT/);
	assert.equal(hosted.current, first, 'the previous workspace is served');
	assert.equal(first.destroyed, false);
	assert.equal(sequence.created[1].destroyed, true, 'the reload that did not settle is discarded');
	assert.equal(hosted.reloads, 0);
});

test('the next request after a reload that did not settle tries again, and serves the new workspace', async () => {
	const sequence = new Sequence(['ready', 'stalled', 'ready']);
	const hosted = generations(sequence);
	await hosted.start();

	hosted.invalidate();
	await assert.rejects(hosted.refresh(), { code: 'UNAVAILABLE' });

	// Nothing changed since: the reload is still owed and is tried again
	await hosted.refresh();
	const [first, , third] = sequence.created;
	assert.equal(sequence.created.length, 3);
	assert.equal(hosted.current, third);
	assert.equal(first.destroyed, true, 'the replaced workspace is destroyed');
	assert.equal(hosted.reloads, 1);

	// And once it succeeded, a request without a change reloads nothing
	await hosted.refresh();
	assert.equal(sequence.created.length, 3);
});

test('requests that arrive during a reload share it', async () => {
	const sequence = new Sequence(['ready', 'stalled']);
	const hosted = generations(sequence);
	await hosted.start();

	hosted.invalidate();
	const outcomes = await Promise.allSettled([hosted.refresh(), hosted.refresh(), hosted.refresh()]);

	assert.equal(sequence.created.length, 2, 'one reload for the three requests');
	outcomes.forEach(outcome => assert.equal(outcome.reason?.code, 'UNAVAILABLE'));
});

test('a reload that fails reports its own error, keeps the previous workspace and is tried again', async () => {
	const sequence = new Sequence(['ready', 'failing', 'ready']);
	const hosted = generations(sequence);
	await hosted.start();
	const [first] = sequence.created;

	hosted.invalidate();
	await assert.rejects(hosted.refresh(), { code: 'READ_FAILED' });
	assert.equal(hosted.current, first);

	await hosted.refresh();
	assert.equal(hosted.current, sequence.created[2]);
});
