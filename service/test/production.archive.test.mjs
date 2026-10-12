import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Members } from '../host/production/members.mjs';
import { Archives } from '../host/production/packing/archives.mjs';
import { Tarball } from '../host/production/packing/tarball.mjs';
import { copy } from '../../tests/production/support/workspaces.mjs';

/**
 * The entries of an npm archive, read with the reader of the source archive's tar
 */
const entries = file => [...Tarball.entries(gunzipSync(readFileSync(file)))];

test('an archive is npm\'s format, reproducible, with the digests npm records', async t => {
	const { root, parent } = copy(t, 'packages');
	const member = new Members(root).resolve('packages/core');
	const first = join(parent, 'first.tgz');
	const second = join(parent, 'second.tgz');
	const packed = await new Tarball(member.directory, member).write(first);
	await new Tarball(member.directory, member).write(second);

	const bytes = readFileSync(first);
	assert.deepEqual(bytes, readFileSync(second), 'equal sources give equal bytes');
	assert.equal(packed.size, bytes.length);
	assert.equal(packed.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
	assert.equal(packed.shasum, createHash('sha1').update(bytes).digest('hex'));
	assert.equal(bytes[9], 255, 'the operating system of the gzip header is fixed');

	const listed = entries(first);
	assert.deepEqual(listed.map(({ path }) => path), ['package/README.md', 'package/index.js', 'package/package.json']);
	assert.ok(listed.every(({ type, mode }) => type === '0' && mode === 0o644), 'files only, no directory entries');
	assert.deepEqual(packed.files, ['README.md', 'index.js', 'package.json']);

	// The system's tar reads it as npm's own archives are read
	const tar = execFileSync('tar', ['-tzf', first], { encoding: 'utf8' }).trim().split('\n');
	assert.deepEqual(tar, ['package/README.md', 'package/index.js', 'package/package.json']);
});

test('an archive holds what the publication would, never secrets, dependencies or what "files" leaves out', async t => {
	const { root, parent, write } = copy(t, 'packages');
	write('packages/ui/.env', 'NOT_A_REAL_SECRET=1\n');
	write('packages/ui/node_modules/dependency/index.js', 'module.exports = 1;\n');
	write(`packages/ui/dist/${'deep/'.repeat(20)}long-name.js`, 'export const deep = true;\n');
	const member = new Members(root).resolve('@production/ui');
	assert.equal(member.id, 'packages/ui', 'a member is named by its package name too');
	const packed = await new Tarball(member.directory, member).write(join(parent, 'ui.tgz'));

	const paths = entries(join(parent, 'ui.tgz')).map(({ path }) => path);
	assert.ok(paths.includes(`package/dist/${'deep/'.repeat(20)}long-name.js`), 'a long path is kept through its pax record');
	assert.ok(paths.includes('package/dist/index.d.ts'));
	assert.ok(!paths.some(path => path.includes('.env') || path.includes('node_modules') || path.startsWith('package/lib/')));
	assert.deepEqual(packed.excluded.secrets, ['.env']);
	assert.ok(packed.excluded.ignored.includes('lib/extra.js'), '"files" leaves lib out');
	assert.deepEqual(packed.excluded.internal, ['node_modules/']);
});

test('npm installs an archive and its consumer runs it, with no network and no script', async t => {
	const { root, parent } = copy(t, 'packages');
	const archives = new Archives(root);
	const record = await archives.create(new Members(root).resolve('packages/core'));
	const consumer = join(parent, 'consumer');
	mkdirSync(consumer);
	writeFileSync(join(consumer, 'package.json'), '{"name": "consumer", "version": "1.0.0", "private": true, "type": "module"}\n');
	const environment = { ...process.env, npm_config_cache: join(parent, 'npm-cache'), npm_config_userconfig: join(parent, 'npmrc'), npm_config_update_notifier: 'false' };
	execFileSync('npm', ['install', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', archives.file(record)], { cwd: consumer, env: environment, stdio: 'pipe', timeout: 120000 });
	const output = execFileSync(process.execPath, ['--input-type=module', '-e', 'const { greet } = await import("@production/core"); console.log(greet("consumer"));'], { cwd: consumer, encoding: 'utf8', timeout: 30000 });
	assert.equal(output.trim(), 'Hello consumer, from @production/core');
	const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
	assert.equal(lock.packages['node_modules/@production/core'].integrity, record.integrity, 'npm recorded the integrity of the archive');
});

test('an archive is found by its identifier and member, checked against its record, and expires', async t => {
	const { root } = copy(t, 'packages');
	let now = Date.parse('2026-10-11T12:00:00Z');
	const archives = new Archives(root, { clock: { now: () => now } });
	const record = await archives.create(new Members(root).resolve('packages/core'));
	assert.match(record.id, /^arc_[0-9a-f]{24}$/);
	assert.deepEqual([record.name, record.version, record.member], ['@production/core', '1.0.0', 'packages/core']);
	assert.equal((await archives.get(record.id, 'packages/core')).integrity, record.integrity);
	assert.equal(readFileSync(join(root, '.beyond', '.gitignore'), 'utf8'), '*\n', '.beyond is ignored by Git');

	await assert.rejects(archives.get(record.id, 'packages/ui'), { code: 'ARCHIVE_NOT_FOUND' }, 'an archive of another member');
	await assert.rejects(archives.get('../../package', 'packages/core'), { code: 'ARCHIVE_NOT_FOUND' }, 'an identifier never reaches outside');
	assert.equal((await archives.bytes(record)).length, record.size);

	writeFileSync(archives.file(record), Buffer.concat([readFileSync(archives.file(record)), Buffer.from('tampered')]));
	await assert.rejects(archives.bytes(record), { code: 'ARCHIVE_CHANGED' });

	now += Archives.RETENTION + 1;
	await archives.sweep();
	await assert.rejects(archives.get(record.id), { code: 'ARCHIVE_NOT_FOUND' }, 'an archive past its retention is removed');
});

test('a member is refused by what it is: unknown, ambiguous by name, or not a package of the root', async t => {
	const { root, write } = copy(t, 'packages');
	const members = new Members(root);
	assert.throws(() => members.resolve('packages/missing'), { code: 'MEMBER_NOT_FOUND' });
	assert.throws(() => members.resolve('..'), { code: 'MEMBER_NOT_FOUND' });
	assert.throws(() => members.resolve(''), { code: 'MEMBER_NOT_FOUND' });
	write('packages/twin/package.json', '{"name": "@production/core", "version": "2.0.0"}\n');
	assert.throws(() => members.resolve('@production/core'), { code: 'MEMBER_AMBIGUOUS' });
	assert.equal(members.resolve('packages/twin').manifest.version, '2.0.0', 'a member named by its directory is never ambiguous');
	write('packages/nameless/package.json', '{"version": "1.0.0"}\n');
	assert.throws(() => members.resolve('packages/nameless'), { code: 'MEMBER_INVALID' });
});
