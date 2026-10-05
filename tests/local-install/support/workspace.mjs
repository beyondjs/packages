/**
 * The harness of the workspace consumption tests, `workspace.test.mjs` and `workspace-types.test.mjs`: a copy of
 * `fixtures/workspace` in a unique temporary directory and the execution projection of that copy.
 */
import { cp, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@beyond-js/packages/workspace';
import { Execution } from '@beyond-js/packages/execution';

export const FIXTURE = fileURLToPath(new URL('../fixtures/workspace/', import.meta.url));

/**
 * The members of the projection. `unlisted` is a member declared after the installation, which it does not have.
 */
export const IDS = ['app-v1', 'app-v2', 'app-v3', 'app-pinned', 'wrap', 'message-v1', '../outside/message-v2'];

export const NODE = { platform: 'node' };
export const BROWSER = { platform: 'browser', environment: 'development' };

/**
 * Every case fails instead of hanging when a package, a compilation or a compiler never becomes ready
 */
export const BOUND = { timeout: 180_000 };

export const codes = diagnostics => (diagnostics ?? []).map(({ code }) => code);

/**
 * Copies the fixture to a unique temporary directory, removed when the test ends: `root`, the member outside it
 * in `outside` and the sources in `store`, each also reachable through a symbolic link (`root-link`,
 * `outside-link`, `store-link`)
 *
 * @param {{ store?: 'link' }} options `store: 'link'` writes the store locations of the projection through the
 * link, as an installation whose store root is reached through a symbolic link would
 */
export async function prepare(t, { store: through } = {}) {
	const base = await realpath(await mkdtemp(join(tmpdir(), 'beyond-workspace-')));
	t.after(() => rm(base, { recursive: true, force: true }));
	for (const part of ['root', 'outside', 'store']) {
		await cp(join(FIXTURE, part), join(base, part), { recursive: true });
		await symlink(join(base, part), join(base, `${part}-link`));
	}

	const [root, outside, store] = ['root', 'outside', 'store'].map(part => join(base, part));
	const escape = path => JSON.stringify(path).slice(1, -1);
	const text = (await readFile(join(FIXTURE, 'execution.json'), 'utf8'))
		.replaceAll('${ROOT}', escape(root))
		.replaceAll('${OUTSIDE}', escape(outside))
		.replaceAll('${STORE}', escape(through === 'link' ? join(base, 'store-link') : store));
	const document = JSON.parse(text);

	// The directory of a member, or the same directory through the link of its parent
	const directory = (id, linked = false) => {
		const outer = id.startsWith('../outside/');
		return join(base, `${outer ? 'outside' : 'root'}${linked ? '-link' : ''}`, outer ? id.slice('../outside/'.length) : id);
	};
	const members = (ids, linked = false) => ids.map(id => ({ id, path: directory(id, linked) }));
	const location = key => document.nodes[key].location;

	// The projection of the run, or a copy of it that a case changes
	const execution = (change = copy => copy) => Execution.from(change(structuredClone(document)), root);
	return { base, root, outside, store, directory, members, location, execution };
}

/**
 * A workspace whose packages have read their manifests, destroyed when the test ends
 */
export async function open(t, root, options) {
	const workspace = new Workspace(root, options);
	t.after(() => workspace.destroy());
	await workspace.ready;
	await Promise.all([...workspace.packages.values()].map(pkg => pkg.ready));
	return workspace;
}
