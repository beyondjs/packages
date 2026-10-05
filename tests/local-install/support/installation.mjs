/**
 * The harness of the installation and execution tests, over the fixtures of `fixtures/installation`:
 *
 * - for `installation.test.mjs`, an in-process registry holding the releases of `registry/`, temporary copies of
 *   `workspace/`, what a declaration of a copy reads, and bounded installations over a temporary store and
 *   metadata cache;
 * - for `execution.test.mjs`, a temporary copy of `projection/` with its projection written for that copy.
 *
 * It never writes the fixtures. The installation is imported when a function needs it, so the execution tests do not
 * load it: the projection reader is tested on its own. A declaration is read by the service's own `Declaration`.
 */
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Execution } from '@beyond-js/packages/execution';
import { FakeRegistry } from '../../cdn-resolution/registry.mjs';
// The service's own declaration reader: the inputs an installation records are the ones the service computes
import { Declaration } from '../../../service/workspace/declaration.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/installation/', import.meta.url));

/**
 * The releases every registry of a test starts with
 */
export const RELEASES = ['lib-a@1.0.0', 'lib-b@1.0.0', 'lib-c@1.0.0', 'lib-dev@1.0.0'];

/**
 * The request counters of a registry that was asked nothing
 */
export const NONE = { packument: 0, manifest: 0, tarball: 0, other: 0 };

export const json = async path => JSON.parse(await readFile(path, 'utf8'));

/**
 * The codes of the diagnostics of a report, in order
 */
export const codes = report => report.diagnostics.map(({ code }) => code);

/**
 * A unique temporary directory, by its real path, removed after the test
 */
export async function temporary(t, prefix) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

/**
 * Copies `fixtures/installation/projection` to a temporary directory (`workspace` is the root, `outside` holds the
 * member outside it, `store` the external sources) and writes its projection with the directories of this run,
 * the fixture's only substitution
 */
export async function projection(t) {
	const base = await temporary(t, 'beyond-execution-');
	const [root, outside, store] = ['workspace', 'outside', 'store'].map(part => join(base, part));
	for (const part of ['workspace', 'outside', 'store']) {
		await cp(join(FIXTURES, 'projection', part), join(base, part), { recursive: true });
	}

	const escape = path => JSON.stringify(path).slice(1, -1);
	const text = (await readFile(join(FIXTURES, 'projection', 'execution.json'), 'utf8'))
		.replaceAll('${ROOT}', escape(root))
		.replaceAll('${OUTSIDE}', escape(outside))
		.replaceAll('${STORE}', escape(store));
	await mkdir(join(root, '.beyond'));
	await writeFile(join(root, Execution.PATH), text);

	const document = JSON.parse(text);
	return { base, root, outside, store, document, inputs: document.inputs };
}

/**
 * Publishes a release of `fixtures/installation/registry`: its manifest and its other files
 */
export async function publish(registry, release) {
	const directory = join(FIXTURES, 'registry', release);
	const files = {};
	for (const file of await readdir(directory)) {
		if (file !== 'package.json') files[file] = await readFile(join(directory, file), 'utf8');
	}
	await registry.publish({ ...(await json(join(directory, 'package.json'))), files });
}

/**
 * What the declaration of a copied workspace reads (`Declaration.read` of the service): its canonical root, its
 * root manifest, its members and the digests of its inputs (`Declaration.inputs`)
 */
export async function declare(root) {
	const declaration = Declaration.read(root);
	if (!declaration.valid) throw new Error(`Invalid workspace ${root}: ${JSON.stringify(declaration.diagnostics)}`);
	const { manifest, members, inputs } = declaration;
	return { root: declaration.root, manifest, members, inputs };
}

/**
 * A registry holding the fixture releases, a store and a metadata cache in a temporary directory, and how to copy
 * the workspace (`workspace(name)`) and create installations over them (`create(root, params)`). Everything is
 * removed after the test.
 */
export async function setup(t) {
	const { Installation } = await import('@beyond-js/packages/installation');
	const registry = await new FakeRegistry({ prefix: '/npm' }).start();
	t.after(() => registry.stop());
	for (const release of RELEASES) await publish(registry, release);

	const base = await temporary(t, 'beyond-installation-');
	const store = join(base, 'store');
	const metadata = join(base, 'metadata');
	// Isolated from this machine: no rc file and no environment of whoever runs the test
	const providers = { values: { default: { registry: registry.url } }, user: false, global: false, env: {} };

	const workspace = async (name = 'workspace') => {
		await cp(join(FIXTURES, 'workspace'), join(base, name), { recursive: true });
		return join(base, name);
	};
	const create = async (root, params = {}) => {
		return new Installation({ ...(await declare(root)), store, metadata, providers, ...params });
	};
	return { registry, base, store, metadata, providers, workspace, create };
}

/**
 * An installation, which must answer within a bounded wait
 */
export async function install(installation, options) {
	let timer;
	const limit = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error('install() never answered')), 60000);
	});
	try {
		return await Promise.race([installation.install(options), limit]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The lock and the projection of a root as they are on disk, null when absent
 */
export const files = root => {
	const read = path => readFile(join(root, path), 'utf8').catch(() => null);
	return Promise.all(['beyond-lock.json', Execution.PATH].map(read));
};

/**
 * Edits the manifest of a member of a copied workspace
 */
export async function edit(root, id, change) {
	const path = join(root, id, 'package.json');
	await writeFile(path, JSON.stringify(change(await json(path)), null, '\t'));
}
