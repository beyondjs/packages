/**
 * The harness of `toolchain.test.mjs`, over the fixtures of `fixtures/toolchain` and the registry releases of
 * `fixtures/installation/registry`:
 *
 * - the toolchain's archives: each directory of `fixtures/toolchain/archives` packed with `npm pack` into a temporary
 *   directory, as the command line's installation packs the components it carries;
 * - an in-process registry with the fixture releases, a temporary store and metadata cache, and a temporary copy of
 *   the workspace, read by the service's own declaration;
 * - installations of that copy with the archives given explicitly, so nothing of the machine running the test (its
 *   own installation of the command line, `BEYOND_TOOLCHAIN_ARCHIVES`) is read.
 *
 * It never writes the fixtures, and removes everything it created after the test.
 */
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FakeRegistry } from '../../cdn-resolution/registry.mjs';
import { RELEASES, declare, publish, temporary } from './installation.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/toolchain/', import.meta.url));
const run = promisify(execFile);

/**
 * Packs every directory of `fixtures/toolchain/archives` into one directory: the toolchain's archives
 */
export async function pack(t) {
	const base = await temporary(t, 'beyond-toolchain-');
	const archives = join(base, 'archives');
	await mkdir(archives);
	for (const release of await readdir(join(FIXTURES, 'archives'))) {
		// A copy is packed, so npm writes nothing beside the fixture
		const copy = join(base, 'sources', release);
		await cp(join(FIXTURES, 'archives', release), copy, { recursive: true });
		await run('npm', ['pack', '--silent', '--pack-destination', archives], { cwd: copy, timeout: 60000 });
	}
	return archives;
}

/**
 * Packs a release of `fixtures/toolchain/archives` again into the archives, with one file of it changed: the same
 * name and version with other bytes
 */
export async function repack(t, archives, release, file, text) {
	const base = await temporary(t, 'beyond-repack-');
	await cp(join(FIXTURES, 'archives', release), base, { recursive: true });
	await writeFile(join(base, file), text);
	await run('npm', ['pack', '--silent', '--pack-destination', archives], { cwd: base, timeout: 60000 });
}

/**
 * The registry, the store, the metadata cache, the toolchain's archives, a copy of the workspace, and how to install
 * it (`create(params)`)
 */
export async function setup(t) {
	const { Installation } = await import('@beyond-js/packages/installation');
	const registry = await new FakeRegistry({ prefix: '/npm' }).start();
	t.after(() => registry.stop());
	for (const release of RELEASES) await publish(registry, release);

	const base = await temporary(t, 'beyond-supplied-');
	const [store, metadata, root] = ['store', 'metadata', 'workspace'].map(part => join(base, part));
	await cp(join(FIXTURES, 'workspace'), root, { recursive: true });
	const archives = await pack(t);
	const providers = { values: { default: { registry: registry.url } }, user: false, global: false, env: {} };

	const create = async (params = {}) => {
		return new Installation({ ...(await declare(root)), store, metadata, providers, toolchain: archives, ...params });
	};
	return { registry, base, store, metadata, root, archives, create };
}

/**
 * The archive of a release among the toolchain's archives, by the file name `npm pack` gives it
 */
export const archive = (archives, name, version) => join(archives, `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`);
