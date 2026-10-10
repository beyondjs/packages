/**
 * External writes of one source that replace the file, as editors, formatters, Git, an AI engine's tools and
 * the File API itself write: a temporary file in the same directory renamed over the source. Every write must
 * be announced as `file.changed` with origin `external`, the builds follow from those events, and an in-place
 * write after the replacements as well.
 *
 * On Linux, Node's recursive `fs.watch` watches each file by its inode, so the first replacement was reported
 * and nothing after it: the service announced one change, built once, and the next edits of the file reached
 * neither `/events` nor a build until a scan. The observer watches every directory instead there; the second
 * case selects that watch on any platform (`BEYOND_DEVELOPMENT_WATCH=directories`), so a macOS run executes it.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/replaced.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Project, Recorder, revision } from './harness.mjs';

const { Files } = await import('@beyond-js/packages/development');

const SOURCE = 'packages/app/main/texts.ts';

/**
 * Serves a temporary root with the observer the environment selects, removed after the case
 */
async function serve(t, seed, watch) {
	const previous = process.env.BEYOND_DEVELOPMENT_WATCH;
	watch ? (process.env.BEYOND_DEVELOPMENT_WATCH = watch) : delete process.env.BEYOND_DEVELOPMENT_WATCH;
	const project = new Project(seed);
	const files = new Files(project.path);
	t.after(() => {
		files.stop();
		project.remove();
		previous === undefined ? delete process.env.BEYOND_DEVELOPMENT_WATCH : (process.env.BEYOND_DEVELOPMENT_WATCH = previous);
	});
	await files.start();
	return { project, files, recorder: new Recorder(files.log) };
}

/**
 * Writes the content to a temporary file beside the source and renames it over the source
 */
function replace(project, path, content, count) {
	const file = project.file(path);
	const temporary = join(dirname(file), `.beyond-write-test-${count}`);
	writeFileSync(temporary, content);
	renameSync(temporary, file);
	return revision(content);
}

const changed = (path, expected) => event =>
	event.type === 'file.changed' && event.path === path && event.origin === 'external' && event.revision === expected;

/**
 * Two replacements and an in-place write of one source, each awaited as its own announcement
 */
async function edit({ project, recorder }, path) {
	const expected = [];
	const original = readFileSync(project.file(path), 'utf8');

	expected.push(replace(project, path, `${original}// first replacement\n`, 1));
	await recorder.until(changed(path, expected[0]));
	expected.push(replace(project, path, `${original}// second replacement\n`, 2));
	await recorder.until(changed(path, expected[1]));
	appendFileSync(project.file(path), '// written in place\n');
	expected.push(revision(readFileSync(project.file(path))));
	await recorder.until(changed(path, expected[2]));

	const announced = recorder.matching(event => event.type === 'file.changed' && event.path === path);
	assert.deepEqual(announced.map(event => event.revision), expected, 'one change per write, in order');
	assert.deepEqual(announced.map(event => event.previous), [revision(original), expected[0], expected[1]]);
}

test('a source replaced twice and then written in place is announced three times', async t => {
	const context = await serve(t, { [SOURCE]: 'export const texts = { title: "one" };\n' });
	await edit(context, SOURCE);
});

test('the watch per directory announces every write, in directories created and renamed after it started', async t => {
	const context = await serve(t, { [SOURCE]: 'export const texts = { title: "one" };\n' }, 'directories');
	await edit(context, SOURCE);

	// A directory created after the start is watched: its file is announced, and so is its replacement
	const later = 'packages/app/later/view.ts';
	mkdirSync(dirname(context.project.file(later)), { recursive: true });
	writeFileSync(context.project.file(later), 'export const view = 1;\n');
	await context.recorder.until(event => event.type === 'file.created' && event.path === later);
	await context.recorder.until(changed(later, replace(context.project, later, 'export const view = 2;\n', 3)));

	// A renamed directory is announced as deletions and creations; its new path is watched, its old one not
	renameSync(context.project.file('packages/app/later'), context.project.file('packages/app/moved'));
	const moved = 'packages/app/moved/view.ts';
	await context.recorder.until(event => event.type === 'file.deleted' && event.path === later);
	await context.recorder.until(event => event.type === 'file.created' && event.path === moved);
	await context.recorder.until(changed(moved, replace(context.project, moved, 'export const view = 3;\n', 4)));
	assert.equal(context.recorder.matching(event => event.path === later && event.type === 'file.changed').length, 1);
});
