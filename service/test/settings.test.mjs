import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Services } from '../host/features.mjs';
import { Feature } from '../host/settings/index.mjs';

/**
 * The local Dev Server settings (`beyond-dev-settings/1`) of a host feature over a temporary workspace, mounted on an
 * allocated loopback port. The environment is a plain object standing for the host's: it is what the feature reads
 * fixed values from and writes live values to.
 */
const EMPTY = `sha256-${createHash('sha256').update('').digest('hex')}`;
const JSON_TYPE = { 'content-type': 'application/json' };

class Announced {
	list = [];
	emit(type, data) {
		this.list.push({ type, ...data });
	}
}

/**
 * The `launch` setting of a service that launches execution targets, which makes `launch.deno` a setting it uses: the
 * paths are never run by these cases
 */
const LAUNCH = { node: { register: '/toolchain/bee-node/register.mjs', launcher: '/toolchain/cli/src/launcher.mjs' } };

/**
 * A feature started over a workspace of its own, with its routes listening; everything is removed after the case. The
 * service launches execution targets unless `launch` is false.
 */
const served = async (t, { environment = {}, deno, launch = true } = {}) => {
	const root = await mkdtemp(join(tmpdir(), 'beyond-settings-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const events = new Announced();
	const services = new Services();
	const settings = launch ? { launch: LAUNCH } : {};
	const feature = new Feature({ root, environment, events, services, settings }, deno ? { deno } : {});
	await feature.start();

	const app = express();
	feature.setup(app);
	const server = await new Promise(resolve => {
		const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
	});
	t.after(() => new Promise(resolve => (server.closeAllConnections(), server.close(resolve))));
	const origin = `http://127.0.0.1:${server.address().port}`;

	const send = async (method, { body, headers = {} } = {}) => {
		const response = await fetch(`${origin}/settings`, { method, headers, body, signal: AbortSignal.timeout(10000) });
		const text = await response.text();
		const json = (response.headers.get('content-type') ?? '').startsWith('application/json');
		return { status: response.status, headers: response.headers, body: json ? JSON.parse(text) : text };
	};
	const change = (values, revision, headers = JSON_TYPE) =>
		send('PUT', { body: JSON.stringify({ values }), headers: { ...headers, ...(revision ? { 'if-match': `"${revision}"` } : {}) } });
	return { root, environment, events, services, feature, send, change, file: join(root, '.beyond', 'settings.json') };
};

const item = (document, key) => document.settings.find(setting => setting.key === key);

test('the document lists the bounded settings with their defaults, when they apply and the variable that sets them', async t => {
	const { send, feature, services } = await served(t);
	const { status, headers, body } = await send('GET');
	assert.equal(status, 200);
	assert.equal(headers.get('cache-control'), 'no-store');
	assert.equal(headers.get('etag'), `"${EMPTY}"`);
	assert.equal(body.protocol, 'beyond-dev-settings/1');
	assert.equal(body.revision, EMPTY, 'an absent file has the revision of no bytes');
	assert.equal(body.diagnostics, void 0);
	assert.deepEqual(body.settings, [
		{ key: 'cdn.origin', default: null, applies: 'live', variable: 'BEYOND_CDN_ORIGIN', value: null, source: 'default', editable: true },
		{ key: 'snapshots.origins', default: [], applies: 'live', variable: 'BEYOND_SNAPSHOTS_ORIGINS', value: [], source: 'default', editable: true },
		{ key: 'previews.timeout', default: 5000, applies: 'live', variable: 'BEYOND_PREVIEW_CDN_TIMEOUT', value: 5000, source: 'default', editable: true },
		{ key: 'launch.deno', default: null, applies: 'launch', variable: 'BEYOND_DENO', value: null, source: 'default', editable: true },
		{ key: 'workspace.timeout', default: 120000, applies: 'restart', variable: 'BEYOND_WORKSPACE_TIMEOUT', value: 120000, source: 'default', editable: true }
	]);
	assert.deepEqual(feature.capabilities, { settings: 1 });
	assert.equal(services.get('settings'), feature, 'the launches feature reads the values from the registry');
	assert.deepEqual([feature.value('cdn.origin'), feature.value('targets.app.api.environment'), feature.value('port')], [null, {}, void 0]);
});

test('a value the environment sets is fixed: it says so, the feature returns it, and a change of it is refused whole', async t => {
	const environment = { BEYOND_PREVIEW_CDN_TIMEOUT: '4000', BEYOND_CDN_ORIGIN: '' };
	const { send, change, feature, file } = await served(t, { environment });
	const { body } = await send('GET');
	assert.deepEqual(item(body, 'previews.timeout'), { key: 'previews.timeout', default: 5000, applies: 'live', variable: 'BEYOND_PREVIEW_CDN_TIMEOUT', value: 4000, source: 'environment', editable: false, reason: { code: 'SETTING_FIXED', message: 'Set when the server was started; start it again to change it' } });
	assert.equal(item(body, 'cdn.origin').source, 'default', 'an empty variable is no value');
	assert.equal(feature.value('previews.timeout'), 4000);

	const refused = await change({ 'previews.timeout': 6000, 'cdn.origin': 'https://cdn.example.com' }, body.revision);
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.code, 'SETTING_FIXED');
	assert.deepEqual(refused.body.error.keys, ['previews.timeout']);
	assert.doesNotMatch(refused.body.error.message, /BEYOND_/, 'the variable is never the message');
	assert.match(refused.body.error.message, /set when the server was started/);
	assert.deepEqual(refused.body.error.details, { variables: ['BEYOND_PREVIEW_CDN_TIMEOUT'] });
	await assert.rejects(stat(file), { code: 'ENOENT' }, 'nothing was written');
	assert.equal(environment.BEYOND_PREVIEW_CDN_TIMEOUT, '4000', 'a fixed variable is never written');
});

test('the Snapshots origins are a list of https or loopback origins, kept and read live, and refused whole otherwise', async t => {
	const { send, change, feature } = await served(t);
	const { body } = await send('GET');
	for (const value of [['http://snapshots.example.com'], ['https://snapshots.example.com/v1'], 'https://snapshots.example.com', [7]]) {
		const refused = await change({ 'snapshots.origins': value }, body.revision);
		assert.deepEqual([refused.status, refused.body.error.code], [422, 'SETTING_INVALID'], JSON.stringify(value));
	}
	const changed = await change({ 'snapshots.origins': ['https://snapshots.example.com/', 'http://snapshots.beyond.localhost:5300'] }, body.revision);
	assert.equal(changed.status, 200);
	assert.deepEqual(feature.value('snapshots.origins'), ['https://snapshots.example.com', 'http://snapshots.beyond.localhost:5300']);
	assert.deepEqual(item(changed.body.document, 'snapshots.origins').source, 'file');
	const cleared = await change({ 'snapshots.origins': null }, changed.body.document.revision);
	assert.deepEqual([cleared.status, feature.value('snapshots.origins')], [200, []]);
});

test('Snapshots origins the server was started with are fixed, as a list', async t => {
	const { send, feature } = await served(t, { environment: { BEYOND_SNAPSHOTS_ORIGINS: 'https://a.example, http://127.0.0.1:5300/' } });
	const { body } = await send('GET');
	assert.deepEqual([item(body, 'snapshots.origins').value, item(body, 'snapshots.origins').editable], [['https://a.example', 'http://127.0.0.1:5300'], false]);
	assert.deepEqual(feature.value('snapshots.origins'), ['https://a.example', 'http://127.0.0.1:5300']);
});

test('a change needs the revision it was based on, as JSON, and a stale revision is a conflict that writes nothing', async t => {
	const { change, send, file } = await served(t);
	const missing = await change({ 'cdn.origin': 'https://cdn.example.com' });
	assert.deepEqual([missing.status, missing.body.error.code], [428, 'PRECONDITION_REQUIRED']);
	const any = await send('PUT', { body: JSON.stringify({ values: {} }), headers: { ...JSON_TYPE, 'if-match': '*' } });
	assert.deepEqual([any.status, any.body.error.code], [428, 'PRECONDITION_REQUIRED']);
	const text = await change({ 'cdn.origin': 'https://cdn.example.com' }, EMPTY, { 'content-type': 'text/plain' });
	assert.deepEqual([text.status, text.body.error.code], [415, 'CONTENT_TYPE_UNSUPPORTED']);
	const malformed = await send('PUT', { body: '{"values": [1]}', headers: { ...JSON_TYPE, 'if-match': `"${EMPTY}"` } });
	assert.deepEqual([malformed.status, malformed.body.error.code], [400, 'BODY_INVALID']);

	const stale = await change({ 'cdn.origin': 'https://cdn.example.com' }, 'sha256-0000');
	assert.equal(stale.status, 409);
	assert.equal(stale.body.outcome, 'conflict');
	assert.equal(stale.body.revision, EMPTY);
	assert.equal(stale.body.document.revision, EMPTY, 'the current document comes with the conflict');
	await assert.rejects(stat(file), { code: 'ENOENT' });
	assert.equal((await send('GET')).body.revision, EMPTY);
});

test('a change is written whole, readable by its user only, ignored by Git, announced, and applied live', async t => {
	const { change, send, environment, events, feature, root, file } = await served(t);
	const answer = await change({ 'cdn.origin': 'https://cdn.example.com/', 'previews.timeout': 2500, 'workspace.timeout': 300000 }, EMPTY);
	assert.equal(answer.status, 200);
	assert.equal(answer.body.outcome, 'completed');
	const bytes = await readFile(file);
	assert.equal(answer.body.revision, `sha256-${createHash('sha256').update(bytes).digest('hex')}`, 'the revision is the digest of the file');
	assert.equal(answer.headers.get('etag'), `"${answer.body.revision}"`);
	assert.deepEqual(JSON.parse(bytes), { protocol: 'beyond-dev-settings/1', values: { 'cdn.origin': 'https://cdn.example.com', 'previews.timeout': 2500, 'workspace.timeout': 300000 } });
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	assert.equal(await readFile(join(root, '.beyond', '.gitignore'), 'utf8'), '*\n');

	assert.deepEqual(events.list, [{ type: 'settings.changed', revision: answer.body.revision }]);
	assert.equal(environment.BEYOND_CDN_ORIGIN, 'https://cdn.example.com', 'what applies live is in the environment the preview reads');
	assert.equal(environment.BEYOND_PREVIEW_CDN_TIMEOUT, '2500');
	assert.equal(environment.BEYOND_WORKSPACE_TIMEOUT, void 0, 'what applies when the service starts again is not');
	assert.deepEqual(item(answer.body.document, 'cdn.origin'), { key: 'cdn.origin', default: null, applies: 'live', variable: 'BEYOND_CDN_ORIGIN', value: 'https://cdn.example.com', source: 'file', editable: true });
	assert.equal(feature.value('workspace.timeout'), 300000);

	// The same values again change nothing and announce nothing
	const again = await change({ 'previews.timeout': 2500 }, answer.body.revision);
	assert.deepEqual([again.status, again.body.revision, events.list.length], [200, answer.body.revision, 1]);

	// Back to the defaults: removed from the file, and the live values cleared rather than left as they were
	const reset = await change({ 'cdn.origin': null, 'previews.timeout': null }, answer.body.revision);
	assert.equal(reset.status, 200);
	assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).values, { 'workspace.timeout': 300000 });
	assert.deepEqual([environment.BEYOND_CDN_ORIGIN, environment.BEYOND_PREVIEW_CDN_TIMEOUT], ['', '']);
	assert.equal(item((await send('GET')).body, 'cdn.origin').source, 'default');
	assert.equal(events.list.length, 2);
});

test('every value is validated first: one diagnostic per refused key, and nothing is written', async t => {
	const { change, file } = await served(t);
	const answer = await change(
		{
			'cdn.origin': 'http://cdn.example.com',
			'previews.timeout': 100,
			'workspace.timeout': 1.5,
			'launch.deno': 'bin/deno',
			'targets.composition.api.environment': { lower: 'x' },
			'targets.Composition.api.environment': {},
			port: 8080
		},
		EMPTY
	);
	assert.equal(answer.status, 422);
	assert.equal(answer.body.error.code, 'SETTING_INVALID');
	const diagnostics = Object.fromEntries(answer.body.error.diagnostics.map(({ key, code }) => [key, code]));
	assert.deepEqual(diagnostics, {
		'cdn.origin': 'SETTING_INVALID',
		'previews.timeout': 'SETTING_INVALID',
		'workspace.timeout': 'SETTING_INVALID',
		'launch.deno': 'SETTING_INVALID',
		'targets.composition.api.environment': 'SETTING_INVALID',
		'targets.Composition.api.environment': 'SETTING_UNKNOWN',
		port: 'SETTING_UNKNOWN'
	});
	await assert.rejects(stat(file), { code: 'ENOENT' });

	for (const [key, value] of [
		['cdn.origin', 'https://cdn.example.com/path'],
		['cdn.origin', 'ftp://cdn.example.com'],
		['cdn.origin', 'https://user:secret@cdn.example.com'],
		['previews.timeout', '5000'],
		['previews.timeout', 30001],
		['workspace.timeout', 9999],
		['targets.composition.api.environment', Object.fromEntries(Array.from({ length: 51 }, (value, index) => [`V${index}`, '1']))],
		['targets.composition.api.environment', { LONG: 'x'.repeat(4097) }],
		['targets.composition.api.environment', { NUMBER: 1 }],
		['targets.composition.api.environment', ['A=1']]
	]) {
		const refused = await change({ [key]: value }, EMPTY);
		assert.deepEqual([refused.status, refused.body.error.diagnostics?.[0]?.key], [422, key], `${key}: ${JSON.stringify(value).slice(0, 40)}`);
	}

	let revision = EMPTY;
	for (const origin of ['https://cdn.example.com', 'http://localhost:8080', 'http://127.0.0.1:9', 'http://cdn.localhost', 'http://[::1]:4000']) {
		const accepted = await change({ 'cdn.origin': origin }, revision);
		assert.deepEqual([accepted.status, item(accepted.body.document, 'cdn.origin').value], [200, origin], origin);
		revision = accepted.body.revision;
	}
});

test('the variables of a target are kept per target, listed after the Deno executable, and given as a copy', async t => {
	const { change, feature } = await served(t);
	const variables = { PORT: '4000', API_KEY: 'not a real key' };
	const answer = await change({ 'targets.composition.api.environment': variables, 'targets.admin.server.environment': { DEBUG: '1' } }, EMPTY);
	assert.equal(answer.status, 200);
	assert.deepEqual(answer.body.document.settings.map(({ key }) => key), [
		'cdn.origin',
		'snapshots.origins',
		'previews.timeout',
		'launch.deno',
		'targets.admin.server.environment',
		'targets.composition.api.environment',
		'workspace.timeout'
	]);
	assert.deepEqual(item(answer.body.document, 'targets.composition.api.environment'), { key: 'targets.composition.api.environment', default: {}, applies: 'launch', value: variables, source: 'file', editable: true });

	const read = feature.value('targets.composition.api.environment');
	read.PORT = 'changed';
	assert.equal(feature.value('targets.composition.api.environment').PORT, '4000', 'a reader cannot change what the feature holds');

	const cleared = await change({ 'targets.composition.api.environment': {} }, answer.body.revision);
	assert.equal(item(cleared.body.document, 'targets.composition.api.environment'), void 0, 'an empty object is the default, not stored');
	assert.deepEqual(feature.value('targets.composition.api.environment'), {});
});

test('a change by hand is read, applied and announced; a file it cannot use is reported and kept', async t => {
	const { send, change, environment, events, file, root } = await served(t);
	await mkdir(join(root, '.beyond'), { recursive: true });
	// Written by hand as the service writes it: readable by its user only
	await writeFile(file, JSON.stringify({ protocol: 'beyond-dev-settings/1', values: { 'cdn.origin': 'https://edited.example.com', 'future.setting': true, 'previews.timeout': -1 } }), { mode: 0o600 });
	const { body } = await send('GET');
	assert.equal(item(body, 'cdn.origin').value, 'https://edited.example.com');
	assert.equal(item(body, 'previews.timeout').source, 'default', 'a refused value is not used');
	assert.deepEqual(body.diagnostics.map(({ key, code }) => [key, code]), [['future.setting', 'SETTING_UNKNOWN'], ['previews.timeout', 'SETTING_INVALID']]);
	assert.equal(environment.BEYOND_CDN_ORIGIN, 'https://edited.example.com');
	assert.deepEqual(events.list.map(({ type }) => type), ['settings.changed']);

	// An unrelated change keeps what this service does not use
	const answer = await change({ 'workspace.timeout': 20000 }, body.revision);
	assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).values, { 'cdn.origin': 'https://edited.example.com', 'future.setting': true, 'previews.timeout': -1, 'workspace.timeout': 20000 });
	assert.equal(answer.status, 200);

	await writeFile(file, 'not json');
	const broken = (await send('GET')).body;
	assert.deepEqual(broken.diagnostics.map(({ code }) => code), ['SETTINGS_FILE_INVALID']);
	assert.equal(item(broken, 'cdn.origin').source, 'default');
	assert.equal(environment.BEYOND_CDN_ORIGIN, '', 'what the file no longer says is no longer applied');
	const replaced = await change({ 'cdn.origin': 'https://cdn.example.com' }, broken.revision);
	assert.equal(replaced.status, 200, 'a broken file is replaced by a change based on its revision');
});

test('a service that verifies delegated grants offers no settings', async t => {
	const { send, feature, services } = await served(t, { environment: { BEYOND_AUTHORITY: '{}' } });
	assert.deepEqual(feature.capabilities, {});
	assert.equal(feature.enabled, false);
	assert.equal(services.has('settings'), false);
	assert.equal((await send('GET')).status, 404);
});
