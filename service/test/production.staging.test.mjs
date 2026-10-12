import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { Owner } from '../host/operations/owner.mjs';
import { Records } from '../host/production/web/records.mjs';
import { Staging } from '../host/production/web/staging.mjs';
import { copy } from '../../tests/production/support/workspaces.mjs';

/**
 * The staging of web exports beside other hosts on the same root (`service/host/production/web/staging.mjs`): a journal
 * names the host that stages an export before anything is staged, and a starting host recovers only what a host that is
 * gone left, never what a live one is writing (an exclusive `beyond build` beside a person's service).
 */

const staged = path => join('.beyond', 'production', 'staging', path);

/**
 * The identifier of a process that ended
 */
const ended = async () => {
	const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
	await new Promise(resolve => child.once('exit', resolve));
	return child.pid;
};

test('a journal names the host that stages an export, before anything is staged and once the moves begin', async t => {
	const { root } = copy(t, 'packages');
	const owner = new Owner({ pid: process.pid, token: 'staging-host' });
	const staging = new Staging(root, 'exp_00000000000000000000bb01', owner);
	await staging.claim();
	const journal = () => JSON.parse(readFileSync(join(root, staged('exp_00000000000000000000bb01.json')), 'utf8'));
	assert.deepEqual(journal(), { id: 'exp_00000000000000000000bb01', owner: { pid: process.pid, token: 'staging-host' } });
	assert.equal(readFileSync(join(root, '.beyond', '.gitignore'), 'utf8'), '*\n', 'the state of the service is ignored by Git');

	await staging.journal('dist/web');
	assert.deepEqual(journal(), { id: 'exp_00000000000000000000bb01', destination: 'dist/web', owner: { pid: process.pid, token: 'staging-host' } });
	await staging.clear();
	assert.equal(existsSync(join(root, staged('exp_00000000000000000000bb01.json'))), false);
});

test('a starting host recovers what a gone host left and leaves alone the export a live host stages', async t => {
	const { root, write } = copy(t, 'packages');
	const records = new Records(root);
	const gone = { pid: await ended(), token: 'gone-host' };

	// A live host (the test runner stands for it) is writing an export: claimed, partly staged, and moving
	const live = 'exp_00000000000000000000cc01';
	write(staged(`${live}.json`), JSON.stringify({ id: live, destination: 'dist/live', owner: { pid: process.ppid, token: 'live-host' } }));
	write(staged(`${live}/index.html`), 'being written');
	write(staged(`${live}.previous/index.html`), 'the export it replaces');

	// A host that died between the moves: the earlier export goes back into its empty destination
	const stopped = 'exp_00000000000000000000cc02';
	write(staged(`${stopped}.json`), JSON.stringify({ id: stopped, destination: 'dist/web', owner: gone }));
	write(staged(`${stopped}.previous/index.html`), 'earlier export');
	write(staged(`${stopped}/index.html`), 'new export, never moved');

	// Staged without a journal: recent, as a writer that is between its temporary journal and its rename; and abandoned
	const recent = 'exp_00000000000000000000cc03';
	write(staged(`${recent}/index.html`), 'staged a moment ago');
	const abandoned = 'exp_00000000000000000000cc04';
	write(staged(`${abandoned}/index.html`), 'staged long ago');
	const old = (Date.now() - 2 * Staging.ABANDONED) / 1000;
	utimesSync(join(root, staged(`${abandoned}/index.html`)), old, old);
	utimesSync(join(root, staged(abandoned)), old, old);

	await Staging.recover(root, records, new Owner());
	assert.equal(readFileSync(join(root, 'dist', 'web', 'index.html'), 'utf8'), 'earlier export');
	assert.equal(existsSync(join(root, staged(stopped))) || existsSync(join(root, staged(`${stopped}.json`))), false, 'what the gone host staged is removed');
	assert.equal(existsSync(join(root, staged(abandoned))), false);

	// Nothing of the live host's export is touched, nor what was staged a moment ago
	assert.equal(readFileSync(join(root, staged(`${live}/index.html`)), 'utf8'), 'being written');
	assert.equal(readFileSync(join(root, staged(`${live}.previous/index.html`)), 'utf8'), 'the export it replaces');
	assert.equal(JSON.parse(readFileSync(join(root, staged(`${live}.json`)), 'utf8')).owner.token, 'live-host');
	assert.equal(existsSync(join(root, 'dist', 'live')), false);
	assert.equal(readFileSync(join(root, staged(`${recent}/index.html`)), 'utf8'), 'staged a moment ago');
});

test('an earlier process with this host\'s own identifier is a gone host, and the staging directory goes once empty', async t => {
	const { root, write } = copy(t, 'packages');
	const records = new Records(root);
	const later = 'exp_00000000000000000000dd01';
	write(staged(`${later}.json`), JSON.stringify({ id: later, destination: 'dist/site', owner: { pid: process.pid, token: 'an-earlier-start' } }));
	write(staged(`${later}.previous/index.html`), 'replaced export');
	write('dist/site/index.html', 'new export, in place');
	write('dist/site/beyond-export.json', JSON.stringify({ protocol: 'beyond-web-export/1', id: later, application: 'site', target: 'web', created: '2026-10-11T12:00:00.000Z' }));

	await Staging.recover(root, records, new Owner({ pid: process.pid, token: 'this-start' }));
	assert.equal(readFileSync(join(root, 'dist', 'site', 'index.html'), 'utf8'), 'new export, in place');
	assert.equal((await records.get(later)).destination, 'dist/site', 'the export in place is recorded');
	assert.equal(existsSync(join(root, '.beyond', 'production', 'staging')), false, 'nothing staged is left');
});
