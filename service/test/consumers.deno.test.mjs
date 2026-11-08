import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DenoConsumer } from '@beyond-js/packages/service';

test('a Deno consumer runs its module file through the Node import map of the service, with nothing more granted', () => {
	const args = DenoConsumer.arguments({ origin: 'http://127.0.0.1:4100', entry: '/opt/cli/launcher.mjs', args: ['app/server', '--port', '0'] });
	assert.deepEqual(args, [
		'run', '--no-config', '--no-lock', '--allow-net=127.0.0.1', '--allow-import=127.0.0.1:4100', '--allow-env', '--quiet',
		'--reload=http://127.0.0.1:4100', '--import-map=http://127.0.0.1:4100/importmap.json?target=node&format=esm',
		'/opt/cli/launcher.mjs', 'app/server', '--port', '0'
	]);
	assert.ok(!args.some(arg => /^--allow-(read|write|run|sys|ffi|all)|^-A$|^--allow-(net|import)$/.test(arg)), 'nothing unscoped and nothing else');
});

test('an executable is run as a consumer only when it answers as Deno 2, as the service checks its setting', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'beyond-deno-check-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const executable = (name, version) => {
		const path = join(directory, name);
		writeFileSync(path, `#!/bin/sh\necho "deno ${version} (stable, release, stand-in)"\n`);
		chmodSync(path, 0o755);
		return path;
	};
	assert.deepEqual(await DenoConsumer.check(executable('deno2', '2.1.4')), { version: '2.1.4' });
	assert.match((await DenoConsumer.check(executable('deno1', '1.46.3'))).message, /Deno 1\.46\.3/);
	assert.match((await DenoConsumer.check(join(directory, 'absent'))).message, /could not be run/);
	assert.deepEqual(await DenoConsumer.check('tools/deno'), { message: 'is not an absolute path' });
});

test('its cache is created in the state directory of the workspace, which ignores itself for Git', async t => {
	const root = await mkdtemp(join(tmpdir(), 'beyond-deno-consumer-'));
	t.after(() => rm(root, { recursive: true, force: true }));

	const directory = await DenoConsumer.prepare(root);
	assert.equal(directory, join(root, '.beyond', 'launches', 'deno'));
	assert.ok((await stat(directory)).isDirectory());
	assert.equal(await readFile(join(root, '.beyond', '.gitignore'), 'utf8'), '*\n');
	// Preparing again changes nothing
	assert.equal(await DenoConsumer.prepare(root), directory);
});

test('an ignore file another feature wrote is kept as it is', async t => {
	const root = await mkdtemp(join(tmpdir(), 'beyond-deno-consumer-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.beyond'));
	await writeFile(join(root, '.beyond', '.gitignore'), '# kept\n*\n');

	await DenoConsumer.prepare(root);
	assert.equal(await readFile(join(root, '.beyond', '.gitignore'), 'utf8'), '# kept\n*\n');
});

test('a root that cannot hold the state directory fails the preparation with its error', async t => {
	const root = await mkdtemp(join(tmpdir(), 'beyond-deno-consumer-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	// A file where the state directory would be
	await writeFile(join(root, '.beyond'), '');
	await assert.rejects(DenoConsumer.prepare(root), error => ['EEXIST', 'ENOTDIR'].includes(error.code));
});
