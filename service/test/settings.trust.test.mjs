import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Services } from '../host/features.mjs';
import { Feature } from '../host/settings/index.mjs';
import { Startup } from '../host/settings/startup.mjs';
import { Store } from '../host/settings/store.mjs';

/**
 * What the settings feature trusts: a settings file only when the service could have written it (a regular file of its
 * user that nobody else may read or write), no reserved variable of a target from a request, and no Deno executable on
 * a service that launches nothing. Over a feature of its own per case, as `settings.test.mjs`.
 */
const EMPTY = `sha256-${createHash('sha256').update('').digest('hex')}`;
const LAUNCH = { node: { register: '/toolchain/bee-node/register.mjs', launcher: '/toolchain/cli/src/launcher.mjs' } };
const VALUES = { protocol: 'beyond-dev-settings/1', values: { 'cdn.origin': 'https://planted.example.com', 'launch.deno': '/planted/deno', 'workspace.timeout': 300000 } };

const workspace = async t => {
	const root = await mkdtemp(join(tmpdir(), 'beyond-settings-trust-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.beyond'));
	return { root, file: join(root, '.beyond', 'settings.json') };
};

/**
 * The feature over a root, its environment a plain object, launching targets unless `launch` is false
 */
const feature = async (root, { launch = true, environment = {} } = {}) => {
	const settings = launch ? { launch: LAUNCH } : {};
	const created = new Feature({ root, environment, services: new Services(), settings, events: { emit: () => void 0 } });
	await created.start();
	return created;
};

const item = (document, key) => document.settings.find(setting => setting.key === key);

test('a settings file the service did not write is read as absent, never applied, and the first change replaces it', async t => {
	const { root, file } = await workspace(t);
	// As a repository that commits one leaves it: readable by everyone
	await writeFile(file, JSON.stringify(VALUES), { mode: 0o644 });
	await chmod(file, 0o644);
	const environment = {};
	const settings = await feature(root, { environment });
	const document = await settings.document();
	assert.equal(document.revision, EMPTY, 'the revision of an absent file');
	assert.deepEqual(document.diagnostics.map(({ code }) => code), ['SETTINGS_FILE_UNTRUSTED']);
	assert.match(document.diagnostics[0].message, /can be read or written by other users \(mode 644\)/);
	assert.deepEqual(['cdn.origin', 'launch.deno', 'workspace.timeout'].map(key => item(document, key).source), ['default', 'default', 'default']);
	assert.deepEqual([settings.value('launch.deno'), environment.BEYOND_CDN_ORIGIN], [null, void 0], 'nothing of it applies');
	assert.equal(new Startup(root).environment({}).BEYOND_WORKSPACE_TIMEOUT, void 0, 'nor at the next start');

	const changed = await settings.change({ 'cdn.origin': 'https://cdn.example.com' }, EMPTY);
	assert.equal(changed.outcome, 'completed');
	assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).values, { 'cdn.origin': 'https://cdn.example.com' }, 'replaced, not merged');
	assert.equal(changed.document.diagnostics, void 0);
});

test('a symbolic link and a FIFO are not files the service wrote, and nothing waits on a FIFO', async t => {
	const { root, file } = await workspace(t);
	const elsewhere = join(root, 'elsewhere.json');
	await writeFile(elsewhere, JSON.stringify(VALUES), { mode: 0o600 });
	await symlink(elsewhere, file);
	const linked = await (await feature(root)).document();
	assert.deepEqual([linked.diagnostics.map(({ code }) => code), item(linked, 'cdn.origin').source], [['SETTINGS_FILE_UNTRUSTED'], 'default']);
	assert.match(linked.diagnostics[0].message, /is a symbolic link/);
	assert.equal(new Startup(root).environment({}).BEYOND_WORKSPACE_TIMEOUT, void 0);

	await rm(file);
	try {
		execFileSync('mkfifo', [file]);
	} catch {
		return t.skip('mkfifo is not available');
	}
	const started = Date.now();
	const piped = await (await feature(root)).document();
	assert.deepEqual(piped.diagnostics.map(({ code }) => code), ['SETTINGS_FILE_UNTRUSTED']);
	assert.match(piped.diagnostics[0].message, /is not a regular file/);
	assert.equal(new Startup(root).environment({}).BEYOND_WORKSPACE_TIMEOUT, void 0);
	assert.ok(Date.now() - started < 2000, 'no read waited for a writer');
});

test('a file of another user is not one the service wrote', () => {
	const stats = { isFile: () => true, uid: 4242, mode: 0o100600 };
	assert.match(Store.distrust(stats, { getuid: () => 501 }), /belongs to another user/);
	assert.equal(Store.distrust({ ...stats, uid: 501 }, { getuid: () => 501 }), void 0);
	assert.match(Store.distrust({ ...stats, uid: 501, mode: 0o100620 }, { getuid: () => 501 }), /mode 620/);
	assert.equal(Store.distrust({ ...stats, mode: 0o100644 }, {}), void 0, 'without users (Windows) the file is read as it is');
});

test('a reserved variable of a target is refused in a change, and one the file holds is kept for the launch to ignore', async t => {
	const { root, file } = await workspace(t);
	const settings = await feature(root);
	for (const name of ['LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'NODE_PATH', 'BEE_URL', 'BEYOND_TOKEN', 'DENO_DIR']) {
		await assert.rejects(settings.change({ 'targets.app.api.environment': { PORT: '4000', [name]: 'x' } }, EMPTY), error => {
			assert.deepEqual([error.status, error.body.error.code, error.body.error.diagnostics[0].code], [422, 'SETTING_INVALID', 'SETTING_INVALID'], name);
			assert.match(error.body.error.diagnostics[0].message, new RegExp(`${name} is reserved`));
			return true;
		});
	}
	assert.equal(existsSync(file), false, 'nothing was written');
	assert.equal((await settings.change({ 'targets.app.api.environment': { PORT: '4000', NODE_ENV: 'development' } }, EMPTY)).outcome, 'completed');

	// Written by hand by the service's user, the reserved name stays in the file and in what a launch reads
	await writeFile(file, JSON.stringify({ protocol: 'beyond-dev-settings/1', values: { 'targets.app.api.environment': { PORT: '4000', NODE_OPTIONS: '--inspect' } } }), { mode: 0o600 });
	const document = await settings.document();
	assert.equal(document.diagnostics, void 0);
	assert.deepEqual(settings.value('targets.app.api.environment'), { PORT: '4000', NODE_OPTIONS: '--inspect' });
});

test('a service that launches nothing offers no Deno executable to change, and runs none', async t => {
	const { root } = await workspace(t);
	const marker = join(root, 'ran');
	const executable = join(root, 'deno');
	// The check runs it with the service's PATH only, which this feature's environment leaves empty
	await writeFile(executable, `#!/bin/sh\n/usr/bin/touch "${marker}"\necho "deno 2.1.4 (stable, release)"\n`, { mode: 0o755 });

	const settings = await feature(root, { launch: false });
	const document = await settings.document();
	assert.deepEqual(item(document, 'launch.deno'), {
		key: 'launch.deno',
		default: null,
		applies: 'launch',
		variable: 'BEYOND_DENO',
		value: null,
		source: 'default',
		editable: false,
		reason: { code: 'LAUNCH_UNAVAILABLE', message: item(document, 'launch.deno').reason.message }
	});
	await assert.rejects(settings.change({ 'launch.deno': executable, 'cdn.origin': 'https://cdn.example.com' }, EMPTY), error => {
		assert.deepEqual([error.status, error.body.error.code, error.body.error.keys], [403, 'SETTING_UNAVAILABLE', ['launch.deno']]);
		return true;
	});
	assert.equal(existsSync(marker), false, 'the executable was never run');

	// The same executable on a service that launches is checked, and kept
	const launching = await feature(root);
	assert.equal(item(await launching.document(), 'launch.deno').editable, true);
	assert.equal((await launching.change({ 'launch.deno': executable }, EMPTY)).outcome, 'completed');
	assert.equal(existsSync(marker), true);
});
