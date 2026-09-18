import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { Project, Recorder, revision, step, wait } from './harness.mjs';

const { Files, Log } = await import('@beyond-js/packages/development');

const start = async (seed, log) => {
	const project = new Project(seed);
	const files = new Files(project.path, log);
	await files.start();
	return { project, files, recorder: new Recorder(files.log) };
};
const finish = ({ project, files }) => (files.stop(), project.remove());
const isFile = (type, path, origin) => event => event.type === type && event.path === path && (!origin || event.origin === origin);

/**
 * The scenarios of contracts/development/scenarios.json that concern source operations and events, executed
 * against the real Files service over a temporary root with real disk writes and the real watcher.
 */
export async function files() {
	await step('edit-with-current-revision: a matching write completes and announces one api change', async () => {
		const context = await start({ 'a.ts': 'one' });
		const result = await context.files.mutate({ operation: 'write', path: 'a.ts', expected: revision('one'), content: 'two' }, { sub: 'usr_ana', kind: 'user' });
		assert.equal(result.outcome, 'completed');
		assert.equal(result.revision, revision('two'));
		const event = await context.recorder.until(isFile('file.changed', 'a.ts', 'api'));
		assert.deepEqual(event.actor, { sub: 'usr_ana', kind: 'user' });
		assert.equal(event.previous, revision('one'));
		finish(context);
		return `revision ${result.revision.slice(0, 18)}…, cursor ${result.cursor}`;
	});

	await step('stale-edit-conflicts: a write based on a superseded revision changes nothing', async () => {
		const context = await start({ 'a.ts': 'one' });
		context.project.write('a.ts', 'agent');
		await context.recorder.until(isFile('file.changed', 'a.ts', 'external'));
		const result = await context.files.mutate({ operation: 'write', path: 'a.ts', expected: revision('one'), content: 'human' });
		assert.deepEqual(result.conflict, { expected: revision('one'), current: revision('agent') });
		assert.equal(readFileSync(context.project.file('a.ts'), 'utf8'), 'agent');
		finish(context);
		return 'conflict reports both revisions; disk keeps the agent text';
	});

	await step('external-write-races-the-index: the expectation is compared with disk, not with the watcher-fed index', async () => {
		const context = await start({ 'a.ts': 'one' });
		context.files.observer.pause();
		context.project.write('a.ts', 'unseen');
		const result = await context.files.mutate({ operation: 'write', path: 'a.ts', expected: revision('one'), content: 'human' });
		assert.equal(result.outcome, 'conflict');
		assert.equal(result.conflict.current, revision('unseen'));
		finish(context);
		return 'conflict although no watcher event was delivered';
	});

	await step('create-over-existing and delete-after-external-delete are conflicts, never silent successes', async () => {
		const context = await start({ 'a.ts': 'one', 'b.ts': 'two' });
		const created = await context.files.mutate({ operation: 'write', path: 'a.ts', expected: 'absent', content: 'new' });
		assert.deepEqual(created.conflict, { expected: 'absent', current: revision('one') });
		rmSync(context.project.file('b.ts'));
		const deleted = await context.files.mutate({ operation: 'delete', path: 'b.ts', expected: revision('two') });
		assert.deepEqual(deleted.conflict, { expected: revision('two'), current: 'absent' });
		finish(context);
	});

	await step('rename-keeps-destination, and a free destination is announced as one api rename', async () => {
		const context = await start({ 'a.ts': 'one', 'b.ts': 'two' });
		const kept = await context.files.mutate({ operation: 'rename', path: 'a.ts', expected: revision('one'), to: 'b.ts' });
		assert.equal(kept.conflict.target, 'b.ts');
		assert.equal(readFileSync(context.project.file('b.ts'), 'utf8'), 'two');

		const moved = await context.files.mutate({ operation: 'rename', path: 'a.ts', expected: revision('one'), to: 'src/c.ts' });
		assert.equal(moved.outcome, 'completed');
		await context.files.observer.flush();
		await wait(150);
		assert.deepEqual(context.recorder.events.map(({ type, path, from }) => [type, path, from]), [['file.renamed', 'src/c.ts', 'a.ts']]);
		assert.ok(!existsSync(context.project.file('a.ts')));
		finish(context);
		return 'one file.renamed event; the watcher added none';
	});

	await step('external-rename-is-delete-and-create', async () => {
		const context = await start({ 'a.ts': 'one' });
		renameSync(context.project.file('a.ts'), context.project.file('b.ts'));
		await context.recorder.until(isFile('file.deleted', 'a.ts', 'external'));
		await context.recorder.until(isFile('file.created', 'b.ts', 'external'));
		assert.equal(context.recorder.matching(event => event.type === 'file.renamed').length, 0);
		finish(context);
	});

	await step('batch-stops-at-first-conflict: ordered, not atomic, reported as partial', async () => {
		const context = await start({ 'a.ts': 'one', 'b.ts': 'two', 'c.ts': 'three' });
		context.files.observer.pause();
		context.project.write('b.ts', 'moved on');
		const batch = await context.files.batch(['a', 'b', 'c'].map((name, index) => (
			{ operation: 'write', path: `${name}.ts`, expected: revision(['one', 'two', 'three'][index]), content: name.toUpperCase() })));
		assert.deepEqual([batch.outcome, ...batch.results.map(({ outcome }) => outcome)], ['partial', 'completed', 'conflict', 'skipped']);
		assert.deepEqual(['a', 'b', 'c'].map(name => readFileSync(context.project.file(`${name}.ts`), 'utf8')), ['A', 'moved on', 'three']);
		const types = context.recorder.events.map(({ type, batch: id }) => [type, id === batch.id]);
		assert.deepEqual(types, [['file.changed', true], ['batch.completed', true]]);
		finish(context);
	});

	await step('path-escape: neither segments nor symbolic links reach outside the root', async () => {
		const context = await start({ 'a.ts': 'one' });
		const attempt = mutation => context.files.mutate({ operation: 'write', expected: 'absent', content: 'x', ...mutation }).then(() => 'accepted', error => error.code);
		assert.equal(await attempt({ path: '../outside.ts' }), 'PATH_INVALID');
		assert.equal(await attempt({ path: '/etc/passwd' }), 'PATH_INVALID');
		assert.equal(await attempt({ path: '.git/config' }), 'PATH_FORBIDDEN');
		symlinkSync('/', context.project.file('escape'));
		assert.equal(await attempt({ path: 'escape/tmp/beyond-escape-proof' }), 'PATH_FORBIDDEN');
		assert.ok(!existsSync('/tmp/beyond-escape-proof'));
		finish(context);
	});

	await step('replay-within-epoch, gap-forces-resync and restart-changes-epoch', async () => {
		const context = await start({ 'a.ts': 'one' }, new Log(3));
		const first = (await context.files.mutate({ operation: 'write', path: 'a.ts', expected: revision('one'), content: 'two' })).cursor;
		await context.files.mutate({ operation: 'write', path: 'a.ts', expected: revision('two'), content: 'three' });
		const replay = context.files.log.since(first);
		assert.deepEqual(replay.events.map(({ type, revision: value }) => [type, value]), [['file.changed', revision('three')]]);

		for (const content of ['4', '5', '6', '7']) {
			const current = revision(readFileSync(context.project.file('a.ts')));
			await context.files.mutate({ operation: 'write', path: 'a.ts', expected: current, content });
		}
		assert.deepEqual(context.files.log.since(first), { resync: 'GAP' });

		const restarted = await start({ 'a.ts': 'one' });
		assert.deepEqual(restarted.files.log.since(first), { resync: 'EPOCH' });
		finish(restarted);
		finish(context);
	});

	await step('scan-finds-missed-changes and duplicate-observation', async () => {
		const context = await start({ 'a.ts': 'one', 'gone.ts': 'x' });
		context.files.observer.pause();
		context.project.write('a.ts', 'missed');
		context.project.write('deep/new.ts', 'n');
		rmSync(context.project.file('gone.ts'));
		await wait(200);
		assert.equal(context.recorder.events.length, 0, 'a paused watcher announces nothing');
		assert.equal((await context.files.tree()).entries.find(({ path }) => path === 'a.ts').revision, revision('one'), 'the unscanned tree is the stale index');

		const tree = await context.files.tree({ scan: true });
		assert.ok(tree.scanned);
		assert.equal(tree.entries.find(({ path }) => path === 'a.ts').revision, revision('missed'));
		const announced = context.recorder.events.map(({ type, path, origin }) => `${type} ${path} ${origin}`).sort();
		assert.deepEqual(announced, ['file.changed a.ts scan', 'file.created deep/new.ts scan', 'file.deleted gone.ts scan']);

		context.files.observer.resume();
		const before = context.recorder.events.length;
		await context.files.mutate({ operation: 'write', path: 'a.ts', expected: revision('missed'), content: 'api' });
		await wait(250);
		await context.files.observer.flush();
		assert.deepEqual(context.recorder.events.slice(before).map(({ type, origin }) => [type, origin]), [['file.changed', 'api']]);
		finish(context);
		return 'scan announced 3 missed changes; an api write observed by the watcher was announced once';
	});
}
