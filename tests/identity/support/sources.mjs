/**
 * The pinned inputs of the identity validation: the preparation store (Widgets, the framework controllers,
 * the development runtime and the frameworks, with the four-family application), the application of this
 * validation and its component library, and the same library pinned from other origins.
 */
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../preparation/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The origin a resolution gives a registry that is not a well known provider: its address as a slug, and a
 * digest of the address so that two addresses never share it (`modules/resolution/origin.ts`)
 */
export const origin = registry => {
	const slug = registry.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	const digest = createHash('sha256').update(registry).digest('hex').slice(0, 8);
	return { provider: `registry-${slug}-${digest}`, registry: `https://${registry}/` };
};

/**
 * The sources of the library that share its name and version: npm, a registry of another host, and two
 * registries under one host that differ only by their path
 */
export const ORIGINS = {
	npm: Store.NPM,
	mirror: origin('npm.mirror.example'),
	'team-a': origin('registry.example.com/team-a'),
	'team-b': origin('registry.example.com/team-b')
};

export class Sources {
	#store;
	get store() {
		return this.#store;
	}

	#kits = new Map();

	/**
	 * The node key of the library for each origin
	 */
	get kits() {
		return this.#kits;
	}

	async create() {
		this.#store = await new Store().create();
		for (const [name, pinned] of Object.entries(ORIGINS)) {
			this.#kits.set(name, (await this.#store.add('@fixture/kit', join(here, '../fixtures/kit'), pinned)).key);
		}
		await this.#store.add('@fixture/shell', join(here, '../fixtures/shell'));
		return this;
	}

	/**
	 * The graph with one source of the library: a graph never pins one name and version twice for one
	 * application, which is what CDN refuses with `UNSUPPORTED_INPUT`
	 *
	 * @param kit The origin of the library this graph keeps
	 */
	graph(kit = 'npm') {
		const graph = structuredClone(this.#store.graph);
		const dropped = new Set([...this.#kits].filter(([name]) => name !== kit).map(([, key]) => key));
		dropped.forEach(key => delete graph.nodes[key]);
		graph.edges = graph.edges.filter(({ from, to }) => !dropped.has(from) && !dropped.has(to));
		return Store.seal(graph);
	}

	/**
	 * The same store copied to another directory and reached through a symbolic link, which is how a
	 * temporary directory of macOS is reached and how a consumer's scratch directory may be
	 *
	 * @returns `{sources, root, remove}`: the sources under the linked location
	 */
	async relocate() {
		const moved = await realpath(await mkdtemp(join(tmpdir(), 'beyond-identity-elsewhere-')));
		const target = join(moved, 'nested/store');
		await cp(this.#store.root, target, { recursive: true });
		const link = join(moved, 'linked');
		await symlink(target, link);

		const sources = Object.fromEntries(Object.entries(this.#store.sources).map(([key, path]) => [key, path.replace(this.#store.root, link)]));
		return { sources, root: moved, remove: () => rm(moved, { recursive: true, force: true }) };
	}

	async remove() {
		await rm(this.#store.root, { recursive: true, force: true });
	}
}
