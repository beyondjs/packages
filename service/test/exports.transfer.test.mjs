import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Events } from '../host/events.mjs';
import { Exports } from '../host/exports/exports.mjs';
import { workspace } from './support/exports.mjs';
import { stand } from './support/snapshots.mjs';

const CAPTURE = 'snp_0123456789abcdef0123456789abcdef';
const PACKAGES = ['.', 'packages/widgets', 'packages/plain'];
const FINAL = ['stored', 'failed', 'unknown'];

/**
 * Exports of a copy of the fixture, allowed to send to a stand-in of Snapshots, with the events they announce
 */
const prepare = async (t, { behaviors, delay, host, environment = {}, packages = PACKAGES } = {}) => {
	const root = workspace(t, { additions: false });
	const snapshots = await stand(t, { behaviors, delay, host });
	const events = [];
	const bus = new Events();
	bus.subscribe((type, data) => events.push({ type, ...data }));
	const exports = new Exports(root, { events: bus, environment: { BEYOND_SNAPSHOTS_ORIGINS: snapshots.origin, ...environment } });
	await exports.start();
	t.after(() => exports.stop());
	const created = await exports.create(packages);
	return { root, snapshots, exports, created, events };
};

/**
 * The export once every package of its transfer has an outcome, within a bound
 */
const settled = async (exports, id, ms = 5000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const record = await exports.get(id);
		if (record.transfer?.packages.every(({ state }) => FINAL.includes(state))) return record;
		if (Date.now() > deadline) throw new Error(`The transfer did not settle within ${ms} ms: ${JSON.stringify(record.transfer)}`);
		await new Promise(resolve => setTimeout(resolve, 20));
	}
};

const states = record => Object.fromEntries(record.transfer.packages.map(({ path, state, error }) => [path, error ? `${state} ${error.code}` : state]));

test('each archive is sent with its own grant, its type and exact length, and the bytes that were exported', async t => {
	const { root, snapshots, exports, created, events } = await prepare(t);
	const started = await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	assert.deepEqual(started.capture, { id: CAPTURE });
	assert.deepEqual(started.transfer.packages.map(({ state }) => state), ['queued', 'queued', 'queued']);

	const done = await settled(exports, created.id);
	assert.deepEqual(states(done), { '.': 'stored', 'packages/widgets': 'stored', 'packages/plain': 'stored' });
	const byPath = Object.fromEntries(snapshots.uploads.map(upload => [upload.path, upload]));
	for (const { path, digest, bytes } of created.packages) {
		const upload = byPath[path];
		assert.equal(upload.authorization, `Grant grant-${path}-secret`, path);
		assert.equal(upload.type, 'application/x-tar');
		assert.deepEqual([upload.length, upload.bytes, upload.digest, upload.capture], [bytes, bytes, digest, CAPTURE], path);
	}

	// The grants stay in memory: no record and no event holds one
	const record = readFileSync(join(root, '.beyond', 'exports', created.id, 'export.json'), 'utf8');
	assert.equal(record.includes('grant-'), false);
	assert.equal(JSON.stringify(events).includes('grant-'), false);

	// Every change was announced, the last one, once it is written, with every package stored
	const changes = () => events.filter(event => event.export.transfer).map(event => states(event.export));
	const deadline = Date.now() + 3000;
	while (JSON.stringify(changes().at(-1)) !== JSON.stringify(states(done)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
	assert.ok(events.every(({ type }) => type === 'export.changed'));
	assert.ok(changes().some(change => Object.values(change).includes('uploading')));
	assert.deepEqual(changes().at(-1), states(done));
});

test('an upload address outside the allowed Snapshots origins refuses the transfer before anything is sent', async t => {
	const { snapshots, exports, created } = await prepare(t);
	const grants = snapshots.grants(CAPTURE, PACKAGES);
	grants[1].upload = 'https://elsewhere.example/v1/captures/x/archive?package=packages%2Fwidgets';
	await assert.rejects(exports.transfer(created.id, { capture: { id: CAPTURE }, grants }), error => error.code === 'EXPORT_DESTINATION' && error.status === 403);

	const unconfigured = new Exports(workspace(t, { additions: false }), { environment: {} });
	const own = await unconfigured.create(['packages/plain']);
	await assert.rejects(unconfigured.transfer(own.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, ['packages/plain']) }), /none is configured/);
	assert.equal(snapshots.uploads.length, 0);
	assert.equal((await exports.get(created.id)).transfer, undefined, 'the export is as it was');
});

test('an upload address must be exactly the archive route of this capture and package', async t => {
	const { snapshots, exports, created } = await prepare(t, { packages: ['packages/plain'] });
	const [grant] = snapshots.grants(CAPTURE, ['packages/plain']);
	const variants = [
		grant.upload.replace(CAPTURE, 'snp_ffffffffffffffffffffffffffffffff'),
		grant.upload.replace('/archive', '/archives'),
		`${grant.upload}&package=.`,
		`${grant.upload}&next=1`,
		grant.upload.replace('package=packages%2Fplain', 'package=.'),
		grant.upload.replace('?package=packages%2Fplain', ''),
		`${grant.upload}#fragment`,
		grant.upload.replace('http://', 'http://user:secret@'),
		grant.upload.replace('127.0.0.1', 'localhost')
	];
	for (const upload of variants) {
		await assert.rejects(exports.transfer(created.id, { capture: { id: CAPTURE }, grants: [{ ...grant, upload }] }), error => error.code === 'EXPORT_DESTINATION', upload);
	}
	assert.equal(snapshots.uploads.length, 0);
	assert.equal((await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: [grant] })).transfer.packages[0].state, 'queued');
});

test('a Snapshots origin under .localhost is reached on 127.0.0.1, its name kept in the address and the Host', async t => {
	const { snapshots, exports, created } = await prepare(t, { host: 'snapshots.beyond.localhost', packages: ['packages/plain'] });
	assert.match(snapshots.origin, /^http:\/\/snapshots\.beyond\.localhost:\d+$/);
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, ['packages/plain']) });
	assert.deepEqual(states(await settled(exports, created.id)), { 'packages/plain': 'stored' });
	const [upload] = snapshots.uploads;
	assert.equal(upload.host, new URL(snapshots.origin).host);
	assert.equal(upload.url, `/v1/captures/${CAPTURE}/archive?package=packages%2Fplain`);
});

test('each package gets exactly one grant, for a package of the export', async t => {
	const { snapshots, exports, created } = await prepare(t);
	const invalid = [
		{ grants: snapshots.grants(CAPTURE, PACKAGES) },
		{ capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, ['.', 'packages/widgets']) },
		{ capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, [...PACKAGES, 'packages/plain']) },
		{ capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, [...PACKAGES, 'tools']) },
		{ capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES).map(grant => ({ ...grant, token: '' })) }
	];
	for (const body of invalid) await assert.rejects(exports.transfer(created.id, body), error => error.code === 'EXPORT_TRANSFER_INVALID' && error.status === 400);
	await assert.rejects(exports.transfer('exp_00000000000000000000000000000000', { capture: { id: CAPTURE }, grants: [] }), error => error.code === 'EXPORT_NOT_FOUND');
	assert.equal(snapshots.uploads.length, 0);
});

test('a redirect is never followed, a refusal fails the package and a 5xx leaves it unknown', async t => {
	const behaviors = { '.': 'redirect', 'packages/widgets': 'refuse', 'packages/plain': 'unavailable' };
	const { snapshots, exports, created } = await prepare(t, { behaviors });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	const done = await settled(exports, created.id);
	assert.deepEqual(states(done), { '.': 'failed EXPORT_DESTINATION', 'packages/widgets': 'failed GRANT_USED', 'packages/plain': 'unknown UNAVAILABLE' });
	assert.equal(snapshots.followed, 0, 'the redirect target was never asked');
});

test('a connection that ends before the answer, or an answer that never comes, leaves the package unknown', async t => {
	const behaviors = { '.': 'drop', 'packages/widgets': 'stall' };
	const { snapshots, exports, created } = await prepare(t, { behaviors, environment: { BEYOND_EXPORT_UPLOAD_TIMEOUT: '400' } });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	const done = await settled(exports, created.id);
	assert.deepEqual(states(done), { '.': 'unknown UPLOAD_DROPPED', 'packages/widgets': 'unknown UPLOAD_TIMEOUT', 'packages/plain': 'stored' });
});

test('an archive whose bytes changed since the export is EXPORT_CHANGED, and nothing of it is sent', async t => {
	const { root, snapshots, exports, created } = await prepare(t);
	writeFileSync(join(root, '.beyond', 'exports', created.id, '1.tar'), 'not the exported bytes');
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	const done = await settled(exports, created.id);
	assert.equal(states(done)['packages/widgets'], 'failed EXPORT_CHANGED');
	assert.deepEqual(snapshots.uploads.map(({ path }) => path).sort(), ['.', 'packages/plain']);
});

test('a grant that expired is not used', async t => {
	const { snapshots, exports, created } = await prepare(t, { packages: ['packages/plain'] });
	const grants = snapshots.grants(CAPTURE, ['packages/plain'], { expires: new Date(Date.now() - 1000).toISOString() });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants });
	assert.equal(states(await settled(exports, created.id))['packages/plain'], 'failed GRANT_EXPIRED');
	assert.equal(snapshots.uploads.length, 0);
});

test('a second transfer sends again only what is not stored, and one transfer of an export runs at a time', async t => {
	const { snapshots, exports, created } = await prepare(t, { behaviors: { 'packages/widgets': 'refuse' } });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	await settled(exports, created.id);

	await assert.rejects(exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, ['.']) }), /missing: packages\/widgets/);
	snapshots.uploads.length = 0;
	const again = await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, ['packages/widgets']) });
	assert.deepEqual(states(again), { '.': 'stored', 'packages/widgets': 'queued', 'packages/plain': 'stored' });
	await assert.rejects(exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) }), error => error.code === 'EXPORT_CONFLICT');
	await settled(exports, created.id);
	assert.deepEqual(snapshots.uploads.map(({ path }) => path), ['packages/widgets']);

	// Another capture is another transfer: every package needs a grant again
	const other = 'snp_ffffffffffffffffffffffffffffffff';
	await assert.rejects(exports.transfer(created.id, { capture: { id: other }, grants: snapshots.grants(other, ['packages/widgets']) }), error => error.code === 'EXPORT_TRANSFER_INVALID');
});

test('at most two uploads run at once', async t => {
	const paths = ['.', 'packages/widgets', 'packages/plain', 'packages/widgets/demo'];
	const behaviors = Object.fromEntries(paths.map(path => [path, 'slow']));
	const { snapshots, exports, created } = await prepare(t, { behaviors, delay: 150, packages: paths });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, paths) });
	await settled(exports, created.id);
	assert.equal(snapshots.uploads.length, 4);
	assert.equal(snapshots.concurrency, 2);
});

test('a transfer that a stop of the service interrupted leaves its packages unknown', async t => {
	const { root, snapshots, exports, created } = await prepare(t, { behaviors: { '.': 'stall', 'packages/widgets': 'stall', 'packages/plain': 'stall' } });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	const deadline = Date.now() + 3000;
	while (snapshots.uploads.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(snapshots.uploads.length, 2, 'two uploads are under way');

	// The record on disk is what a new service reads
	const restarted = new Exports(root, { environment: { BEYOND_SNAPSHOTS_ORIGINS: snapshots.origin } });
	await restarted.start();
	t.after(() => restarted.stop());
	const recovered = await restarted.get(created.id);
	assert.deepEqual(Object.values(states(recovered)), ['unknown EXPORT_INTERRUPTED', 'unknown EXPORT_INTERRUPTED', 'unknown EXPORT_INTERRUPTED']);
	assert.equal(JSON.stringify(recovered).includes('grant-'), false);
});

test('removing an export cancels its transfer and removes its archives', async t => {
	const { root, snapshots, exports, created } = await prepare(t, { behaviors: { '.': 'stall', 'packages/widgets': 'stall' } });
	await exports.transfer(created.id, { capture: { id: CAPTURE }, grants: snapshots.grants(CAPTURE, PACKAGES) });
	const deadline = Date.now() + 3000;
	while (snapshots.uploads.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));

	assert.equal(await exports.remove(created.id), true);
	await assert.rejects(exports.get(created.id), error => error.code === 'EXPORT_NOT_FOUND');
	assert.equal(await exports.remove(created.id), false);
	const { existsSync } = await import('node:fs');
	assert.equal(existsSync(join(root, '.beyond', 'exports', created.id)), false);
	assert.deepEqual(snapshots.uploads.map(({ path }) => path).sort(), ['.', 'packages/widgets'], 'the third package was never sent');
});
