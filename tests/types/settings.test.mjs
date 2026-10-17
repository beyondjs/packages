import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

/**
 * The local Dev Server settings (`beyond-dev-settings/1`) of the real development service started from this
 * checkout, over the type browsing fixture: a change of `cdn.origin` through `PUT /settings` reaches the next
 * description of a preview without a restart, as does the bound of its CDN checks, a value the environment sets is
 * fixed, and every change is announced on the event stream. The service starts with `BEYOND_WORKSPACE_TIMEOUT` set and
 * `BEYOND_CDN_ORIGIN` and `BEYOND_PREVIEW_CDN_TIMEOUT` empty.
 */
const served = new Served();
const environment = { BEYOND_WORKSPACE_TIMEOUT: '200000', BEYOND_CDN_ORIGIN: '', BEYOND_PREVIEW_CDN_TIMEOUT: '' };
// It launches execution targets, so the Deno executable is one of its settings
before(() => served.start({ environment, launch: true }), { timeout: 600000 });
after(() => served.stop(), { timeout: 120000 });

const JSON_TYPE = { 'content-type': 'application/json' };
const ENTRY = '/preview/entry.json?entry=@types-fixture/app/text';
const refused = answer => [answer.status, answer.body?.error?.code];
const setting = (document, key) => document.settings.find(one => one.key === key);
const read = () => served.send('GET', '/settings', { headers: served.headers });
const change = (values, revision) =>
	served.send('PUT', '/settings', { headers: { ...served.headers, ...JSON_TYPE, 'if-match': `"${revision}"` }, body: JSON.stringify({ values }) });

test('the service claims its settings, and a value its environment sets is fixed', async () => {
	assert.equal(served.session.capabilities.settings, 1);
	const { status, body } = await read();
	assert.equal(status, 200);
	assert.deepEqual(setting(body, 'workspace.timeout'), { key: 'workspace.timeout', default: 120000, applies: 'restart', variable: 'BEYOND_WORKSPACE_TIMEOUT', value: 200000, source: 'environment', editable: false, reason: { code: 'SETTING_FIXED', message: 'Set when the server was started; start it again to change it' } });
	assert.deepEqual([setting(body, 'cdn.origin').source, setting(body, 'previews.timeout').source], ['default', 'default'], 'an empty variable is no value');
	assert.deepEqual(refused(await change({ 'workspace.timeout': 300000 }, body.revision)), [403, 'SETTING_FIXED']);
});

test('a change of the CDN origin reaches the next preview description without a restart, and is announced', async () => {
	const before = (await served.send('GET', ENTRY, { headers: served.headers })).body;
	assert.equal(before.cdn.origin, void 0, JSON.stringify(before.cdn));
	assert.match(before.cdn.reason, /BEYOND_CDN_ORIGIN is not set/);

	const stream = await served.events();
	try {
		const { body: document } = await read();
		const answer = await change({ 'cdn.origin': 'http://127.0.0.1:9' }, document.revision);
		assert.equal(answer.status, 200, JSON.stringify(answer.body));
		const announced = await stream.until('settings.changed');
		assert.equal(announced.data.revision, answer.body.revision);

		const after = (await served.send('GET', ENTRY, { headers: served.headers })).body;
		assert.deepEqual(after.cdn, { origin: 'http://127.0.0.1:9' });
		const file = join(served.root, '.beyond', 'settings.json');
		assert.equal(statSync(file).mode & 0o777, 0o600);

		// Back to none, as live
		const reset = await change({ 'cdn.origin': null }, answer.body.revision);
		assert.equal(reset.status, 200);
		const cleared = (await served.send('GET', ENTRY, { headers: served.headers })).body;
		assert.equal(cleared.cdn.origin, void 0);
		assert.match(cleared.cdn.reason, /BEYOND_CDN_ORIGIN is not set/);
	} finally {
		stream.close();
	}
});

test('the bound of the preview\'s CDN checks changes live too: a CDN that does not answer is unavailable within it', async t => {
	// A CDN that accepts every request and never answers
	const silent = createServer(() => void 0);
	await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => (silent.closeAllConnections(), silent.close(resolve))));
	const origin = `http://127.0.0.1:${silent.address().port}`;

	const { body: document } = await read();
	const answer = await change({ 'cdn.origin': origin, 'previews.timeout': 500 }, document.revision);
	assert.equal(answer.status, 200, JSON.stringify(answer.body));
	t.after(async () => change({ 'cdn.origin': null, 'previews.timeout': null }, (await read()).body.revision));

	// The installed packages the entry imports are addressed on the CDN, and checked there
	const packages = ['@types-fixture/app', '@types-fixture/packaged', '@beyond-js/local-2026'];
	const selected = await served.send('PUT', '/development/selection', { headers: { ...served.headers, ...JSON_TYPE }, body: JSON.stringify({ packages, externals: 'cdn' }) });
	assert.equal(selected.status, 200, JSON.stringify(selected.body));
	t.after(() => served.send('DELETE', '/development/selection', { headers: served.headers }));

	const started = Date.now();
	const described = (await served.send('GET', '/preview/entry.json?entry=@types-fixture/app/main', { headers: served.headers })).body;
	const elapsed = Date.now() - started;
	const conditioned = described.modules.find(({ specifier }) => specifier === 'conditioned');
	assert.equal(conditioned?.source, 'unresolved', JSON.stringify(described.modules));
	assert.ok(described.diagnostics.some(({ code, message }) => code === 'PREVIEW_CDN_UNAVAILABLE' && message.includes('500 ms')), JSON.stringify(described.diagnostics));
	assert.ok(elapsed < 4500, `the description waited ${elapsed} ms, under the default bound of 5000 ms`);
});

test('a Deno executable is checked before it is kept, and a stale change is a conflict', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'beyond-settings-deno-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const deno = join(directory, 'deno');
	writeFileSync(deno, '#!/bin/sh\necho "deno 2.2.0 (stable, release)"\n');
	chmodSync(deno, 0o755);
	const old = join(directory, 'old-deno');
	writeFileSync(old, '#!/bin/sh\necho "deno 1.45.0 (stable, release)"\n');
	chmodSync(old, 0o755);

	const { body: document } = await read();
	const invalid = await change({ 'launch.deno': old }, document.revision);
	assert.deepEqual(refused(invalid), [422, 'SETTING_INVALID']);
	assert.match(invalid.body.error.diagnostics[0].message, /Deno 2 is required/);

	const kept = await change({ 'launch.deno': deno }, document.revision);
	assert.equal(kept.status, 200, JSON.stringify(kept.body));
	assert.deepEqual([setting(kept.body.document, 'launch.deno').value, setting(kept.body.document, 'launch.deno').source], [deno, 'file']);

	const stale = await change({ 'launch.deno': null }, document.revision);
	assert.equal(stale.status, 409);
	assert.equal(setting(stale.body.document, 'launch.deno').value, deno, 'nothing was changed');
});

test('a settings file the service did not write is not read, and the first change replaces it', async t => {
	const file = join(served.root, '.beyond', 'settings.json');
	writeFileSync(file, JSON.stringify({ protocol: 'beyond-dev-settings/1', values: { 'cdn.origin': 'http://127.0.0.1:9' } }), { mode: 0o644 });
	chmodSync(file, 0o644);
	t.after(() => rmSync(file, { force: true }));
	const { body } = await read();
	assert.deepEqual(body.diagnostics?.map(({ code }) => code), ['SETTINGS_FILE_UNTRUSTED']);
	assert.equal(setting(body, 'cdn.origin').source, 'default', 'nothing of it applies');
	const replaced = await change({ 'previews.timeout': 4000 }, body.revision);
	assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.equal(replaced.body.document.diagnostics, void 0);
	await change({ 'previews.timeout': null }, replaced.body.revision);
});

test('the settings are the service clients\' own: a local consumer and a page of another site are refused', async () => {
	assert.deepEqual(refused(await served.send('GET', '/settings')), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(refused(await served.send('GET', '/settings', { headers: { origin: 'https://evil.example' } })), [401, 'PAIRING_REQUIRED']);
	const put = await served.send('PUT', '/settings', { headers: { ...JSON_TYPE, 'if-match': '"x"' }, body: '{"values":{}}' });
	assert.deepEqual(refused(put), [401, 'CREDENTIAL_REQUIRED']);
});
