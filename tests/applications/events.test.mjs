import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSON_TYPE, Served } from './support/served.mjs';

/**
 * How a change of the declaration reaches a client of the real development service, over a copy of
 * `fixtures/workspace`: through `Config` and the watchers service alone (`BEYOND_APPLICATIONS_FOLLOW=watchers` turns
 * off the File API's events as a second trigger), as `applications.changed` on `GET /events`, after the File API's
 * own event, without a request or polling; converging on the newest of rapid edits and after a malformed file. It
 * measures what an edit of the declaration costs in builds, and that a changed manifest announces `workspace.changed`.
 */
process.env.BEYOND_APPLICATIONS_FOLLOW = 'watchers';
const served = new Served('workspace');
let events;
before(async () => {
	await served.start();
	events = await served.stream('/events');
	await events.until('subscribed');
}, { timeout: 600000 });
after(async () => {
	events?.close();
	await served.stop();
}, { timeout: 120000 });

const file = path => join(served.root, ...path.split('/'));
const revision = path => `sha256-${createHash('sha256').update(readFileSync(file(path))).digest('hex')}`;
const changed = (path, generation = 0) => event => event.type === 'applications.changed' && event.data.revision === revision(path) && event.data.generation > generation;
const index = event => events.events.indexOf(event);

/**
 * Writes a file as another program would and waits, from the stream alone, for the catalog to announce it; the first
 * write is retried within a bound while the watcher of the root is being started
 */
const write = async (path, content, ms = 15000) => {
	events.mark();
	writeFileSync(file(path), content);
	return events.until(changed(path), ms);
};
const json = value => `${JSON.stringify(value, null, '\t')}\n`;
const original = JSON.parse(readFileSync(new URL('./fixtures/workspace/beyond.json', import.meta.url), 'utf8'));
const titled = title => ({ ...original, applications: { composition: { ...original.applications.composition, title } } });

test('the watchers service follows beyond.json: an external edit is announced after the File API event, without a request', async () => {
	// The watcher of the root is started in the background: the first edits are repeated until one is announced
	let announced;
	for (let attempt = 1; !announced && attempt <= 8; attempt++) {
		announced = await write('beyond.json', json(titled(`Watched ${attempt}`)), 7500).catch(() => void 0);
	}
	assert.ok(announced, 'an edit of beyond.json was announced');

	events.mark();
	writeFileSync(file('beyond.json'), json(titled('Edited outside')));
	const event = await events.until(changed('beyond.json'));
	const own = events.events.find(one => one.type.startsWith('file.') && one.data.path === 'beyond.json' && one.data.revision === revision('beyond.json'));
	assert.ok(own && index(own) < index(event), 'the File API announced the file before the catalog announced the change');
	assert.ok(['external', 'scan'].includes(own.data.origin));
	assert.deepEqual(Object.keys(event.data).sort(), ['cursor', 'generation', 'revision', 'type']);

	const { body } = await served.send('GET', '/applications');
	assert.deepEqual([body.generation, body.applications[0].title], [event.data.generation, 'Edited outside']);
	assert.deepEqual(body.following, { live: true, watchers: 'ready', events: false }, 'the watchers service alone follows it');
});

test('a write through the catalog is announced the same way, after its own file event', async () => {
	const { body: current } = await served.send('GET', '/applications');
	events.mark();
	const value = { ...original.applications.composition, title: 'Written by the interface' };
	const written = await served.send('PUT', '/applications/composition', { headers: { ...served.headers, ...JSON_TYPE, 'if-match': `"${current.document.revision}"` }, body: value });
	assert.equal(written.status, 200, JSON.stringify(written.body));
	const event = await events.until(changed('beyond.json', current.generation));
	const own = events.since().find(one => one.type === 'file.changed' && one.data.path === 'beyond.json' && one.data.origin === 'api');
	assert.ok(own && index(own) < index(event));
	assert.equal(event.data.revision, written.body.revision);
});

test('a file-backed branch is followed too, and rapid edits converge on the newest with growing generations', async () => {
	// Once the branch names a file, the catalog's revision is the file's
	events.mark();
	writeFileSync(file('beyond.json'), json({ ...original, applications: 'config/applications.json' }));
	await events.until(changed('config/applications.json'));
	const { body: switched } = await served.send('GET', '/applications');
	assert.equal(switched.document.path, 'config/applications.json');

	const named = JSON.parse(readFileSync(file('config/applications.json'), 'utf8'));
	const version = n => json({ site: { ...named.site, title: `Site ${n}` } });
	await write('config/applications.json', version(0));

	events.mark();
	for (let n = 1; n <= 6; n++) writeFileSync(file('config/applications.json'), version(n));
	await events.until(changed('config/applications.json'), 30000);
	const announced = events.since().filter(({ type }) => type === 'applications.changed').map(({ data }) => data.generation);
	assert.ok(announced.every((generation, i) => i === 0 || generation > announced[i - 1]), `generations grow: ${announced}`);

	const { body } = await served.send('GET', '/applications');
	assert.deepEqual([body.applications[0].title, body.document.revision], ['Site 6', revision('config/applications.json')]);
	assert.ok(body.generation >= announced.at(-1));
});

test('a malformed file gives a catalog with its diagnostics, and its correction converges', async () => {
	const named = readFileSync(file('config/applications.json'), 'utf8');
	await write('config/applications.json', '{ "site": { "title": ');
	const { body: broken } = await served.send('GET', '/applications');
	assert.deepEqual([broken.diagnostics.map(({ code }) => code), broken.applications], [['APPLICATIONS_FILE_INVALID'], []]);

	await write('config/applications.json', named);
	const { body: fixed } = await served.send('GET', '/applications');
	assert.deepEqual([fixed.diagnostics, fixed.applications.map(({ id }) => id)], [[], ['site']]);
	assert.ok(fixed.generation > broken.generation);
});

/**
 * Waits until no build runs and the stream has been silent for a while, so that what a measure observes is caused by
 * its own edit; bounded
 */
const quiet = async (silence = 1500) => {
	for (const deadline = Date.now() + 180000; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 100))) {
		const running = new Set();
		for (const { type, data } of events.events) {
			type === 'build.started' && running.add(data.build.id);
			type === 'build.ended' && running.delete(data.build.id);
		}
		if (!running.size && Date.now() - (events.events.at(-1)?.at ?? 0) > silence) return;
	}
	throw new Error('The service did not become quiet within 180 s');
};

/**
 * The build an edit made after a mark caused: its duration as the stream received it, the hashes of its outputs, and
 * whether the workspace was reloaded for it (`workspace.changed` within a short window after the build ended)
 */
const build = async () => {
	const started = await events.until('build.started', 120000);
	const ended = await events.until(event => event.type === 'build.ended' && event.data.build.id === started.data.build.id, 300000);
	const hashes = Object.fromEntries(ended.data.build.modules.map(({ vspecifier, platform, hash }) => [`${vspecifier}:${platform}`, hash]));
	const reloaded = await events.until('workspace.changed', 3000).then(() => true, () => false);
	return { ms: ended.at - started.at, hashes, modules: ended.data.build.modules.length, reloaded };
};

test('measured: an edit of the declaration rebuilds no module unless a manifest of the workspace changed', async t => {
	// A baseline: the build of an unchanged workspace
	await quiet();
	events.mark();
	assert.equal((await served.send('POST', '/builds', { headers: { ...served.headers, ...JSON_TYPE } })).status, 202);
	const baseline = await build();

	// A file that declares nothing: a build follows every source change, and asks the processors it already has
	await quiet();
	events.mark();
	writeFileSync(file('notes.md'), `edited ${Date.now()}\n`);
	const unrelated = await build();

	// The branch in its own file: an edit of applications.json is no manifest
	await quiet();
	events.mark();
	const named = JSON.parse(readFileSync(file('config/applications.json'), 'utf8'));
	writeFileSync(file('config/applications.json'), json({ site: { ...named.site, title: 'Measured' } }));
	const declared = await build();
	await events.until(changed('config/applications.json'));

	// The branch inline: the host compares beyond.json without its applications, so an edit of them is no manifest change either
	await quiet();
	await write('beyond.json', json(original));
	await quiet();
	events.mark();
	writeFileSync(file('beyond.json'), json(titled('Measured inline')));
	const inline = await build();

	const report = ({ ms, modules, reloaded }) => `${ms} ms, ${modules} module outputs, workspace reloaded: ${reloaded}`;
	t.diagnostic(`baseline build (POST /builds): ${report(baseline)}`);
	t.diagnostic(`after an unrelated file edit: ${report(unrelated)}`);
	t.diagnostic(`after an edit of the applications in config/applications.json: ${report(declared)}`);
	t.diagnostic(`after an edit of the applications inline in beyond.json: ${report(inline)}`);
	for (const measured of [unrelated, declared, inline]) assert.deepEqual(measured.hashes, baseline.hashes, 'every output keeps its identity');
	assert.equal(declared.reloaded, false, 'an edit of the applications file reloads nothing');
	assert.equal(inline.reloaded, false, 'an edit of the applications inline in beyond.json reloads nothing');
	assert.equal(unrelated.reloaded, false);
});

test('a changed manifest of a member reloads the workspace and announces workspace.changed', async () => {
	events.mark();
	const manifest = JSON.parse(readFileSync(file('shared/package.json'), 'utf8'));
	writeFileSync(file('shared/package.json'), json({ ...manifest, description: 'A changed description' }));
	const announced = await events.until('workspace.changed', 120000);
	assert.ok(announced.data.reloads >= 1, JSON.stringify(announced.data));
	const own = events.since().find(one => one.type.startsWith('file.') && one.data.path === 'shared/package.json');
	assert.ok(own && index(own) < index(announced));

	// The session and the state describe the reloaded workspace
	assert.equal((await served.send('GET', '/state')).status, 200);
});
