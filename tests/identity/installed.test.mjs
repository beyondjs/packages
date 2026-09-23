/**
 * Installed packages in development: a name and version do not identify bytes.
 *
 * The development service compiles the installed packages a browser needs (`Installed`, one public subpath at
 * a time). In development an installation is mutable: reinstalling from another registry, a patched copy or a
 * new link replaces the files of a package under the same version. What is compiled is kept under the
 * installation it was compiled from, so a replaced installation is compiled again instead of being answered
 * from what the service compiled before. Where several bases hold the package, the first base that holds the
 * requested version is the one used, deterministically.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/identity/installed.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Installed } from '@beyond-js/packages/artifacts';

const NAME = 'identity-installed';
const CONDITIONS = { platform: 'browser', environment: 'development' };

/**
 * Installs a one-module package under `<base>/node_modules`, as a package manager leaves it
 */
async function install(base, value, stamp) {
	const root = join(base, 'node_modules', NAME);
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'index.js'), `export const value = ${JSON.stringify(value)};\n`);
	const manifest = join(root, 'package.json');
	await writeFile(manifest, JSON.stringify({ name: NAME, version: '1.0.0', type: 'module', exports: { '.': './index.js' } }));
	// A reinstall writes its manifest later than the one it replaces
	if (stamp) await utimes(manifest, stamp, stamp);
	return root;
}

const compiled = async installed => {
	const { module, failure } = await installed.module({ name: NAME, version: '1.0.0', subpath: '.' }, CONDITIONS);
	assert.equal(failure, undefined, JSON.stringify(failure));
	return module;
};

test('an installation replaced under the same version is compiled again', async t => {
	const base = await realpath(await mkdtemp(join(tmpdir(), 'beyond-installed-')));
	t.after(() => rm(base, { recursive: true, force: true }));
	const installed = new Installed(() => [base]);

	await install(base, 'first');
	const first = await compiled(installed);
	assert.match(first.code('none'), /"first"/);
	assert.equal((await compiled(installed)).hash, first.hash, 'an unchanged installation is answered from what was compiled');

	await install(base, 'second', new Date(Date.now() + 60_000));
	const second = await compiled(installed);
	assert.match(second.code('none'), /"second"/, 'the replaced installation is what is served');
	assert.notEqual(second.hash, first.hash);
});

test('the first base that holds the requested version is the installation used', async t => {
	const [one, other] = await Promise.all([1, 2].map(async () => realpath(await mkdtemp(join(tmpdir(), 'beyond-installed-')))));
	t.after(() => Promise.all([one, other].map(base => rm(base, { recursive: true, force: true }))));
	const root = await install(one, 'from the first base');
	await install(other, 'from the second base');

	const installed = new Installed(() => [one, other]);
	assert.equal(installed.locate(NAME, '1.0.0'), root);
	assert.match((await compiled(installed)).code('none'), /from the first base/);
	assert.equal(installed.locate(NAME, '2.0.0'), undefined, 'only the exact version is an installation of it');
	const { failure } = await installed.module({ name: NAME, version: '2.0.0', subpath: '.' }, CONDITIONS);
	assert.equal(failure?.code, 'PACKAGE_NOT_FOUND');
});
