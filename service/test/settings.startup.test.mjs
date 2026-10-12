import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Deadline } from '../deadline.mjs';
import { Startup } from '../host/settings/startup.mjs';

/**
 * `workspace.timeout` applies when the service starts again: a starting host reads `BEYOND_WORKSPACE_TIMEOUT` from
 * its environment completed with the stored value, unless that environment sets the variable itself.
 */
const workspace = async (t, values) => {
	const root = await mkdtemp(join(tmpdir(), 'beyond-startup-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	if (values !== void 0) {
		await mkdir(join(root, '.beyond'));
		// As the service writes it: readable by its user only (a file others may read is not read at all)
		await writeFile(join(root, '.beyond', 'settings.json'), typeof values === 'string' ? values : JSON.stringify({ protocol: 'beyond-dev-settings/1', values }), { mode: 0o600 });
	}
	return root;
};

const reading = environment => new Deadline('BEYOND_WORKSPACE_TIMEOUT', 120000).read(environment);

test('a stored workspace bound is what a starting host reads, without changing the environment it was given', async t => {
	const root = await workspace(t, { 'workspace.timeout': 300000, 'cdn.origin': 'https://cdn.example.com' });
	const given = { PATH: '/bin' };
	const completed = new Startup(root).environment(given);
	assert.equal(reading(completed), 300000);
	assert.equal(completed.BEYOND_CDN_ORIGIN, void 0, 'only what applies at a start is completed');
	assert.deepEqual(given, { PATH: '/bin' });
});

test('the environment wins, and a missing, broken or refused value leaves the default', async t => {
	assert.equal(reading(new Startup(await workspace(t, { 'workspace.timeout': 300000 })).environment({ BEYOND_WORKSPACE_TIMEOUT: '90000' })), 90000);
	assert.equal(reading(new Startup(await workspace(t)).environment({})), 120000);
	assert.equal(reading(new Startup(await workspace(t, 'not json')).environment({})), 120000);
	assert.equal(reading(new Startup(await workspace(t, { 'workspace.timeout': 5 })).environment({})), 120000);
});
