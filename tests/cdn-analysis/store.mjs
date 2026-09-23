/**
 * The fixture store of the CDN analysis and output validations: the packages under `./fixtures/`, copied into
 * a temporary directory as extracted packages, and the pinned graph that joins them. No network access.
 *
 * - `@fixture/app` (Beyond sources, `fixtures/app`): the application. `./main` is its entry; `./admin` is
 *   never reached.
 * - `@fixture/ui` (Beyond sources, `fixtures/ui`): `./widget` (eager, with a stylesheet, a declared logo and a
 *   font), `./chart` (reached only through a dynamic import), `./theme` (a style public module), `./extra`
 *   (only reachable through a declaration) and `./unused` (never reached).
 * - `fake-react`, `fake-react-dom` (`fixtures/fake-react`, `fixtures/fake-react-dom`): ordinary CommonJS npm
 *   packages shaped like React and its renderer: `exports` conditions, `process.env.NODE_ENV` branches, and a
 *   peer that must stay one shared module.
 *
 * `fixtures/ui-distribution` is `@fixture/ui` laid out as a hand-written precompiled distribution; the checks
 * that need it place it with `copy()`. The README of this directory describes every fixture.
 */
import { cp, mkdtemp, mkdir, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The checked-in fixture packages, located from this module so the store works from any working directory
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * The store of extracted packages and its graph
 */
export class Store {
	#root;
	get root() {
		return this.#root;
	}

	#packages = new Map();

	/**
	 * The `sources` input of analysis and generation: node key → extracted package root
	 */
	get sources() {
		return Object.fromEntries([...this.#packages].map(([key, { directory }]) => [key, join(this.#root, directory)]));
	}

	/**
	 * A node of the graph as the contract defines it, with an integrity derived from its identity
	 */
	static node(name, version) {
		const integrity = `sha512-${createHash('sha512').update(`${name}@${version}`).digest('base64')}`;
		const tarball = `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
		return { name, version, origin: { provider: 'npm', registry: 'https://registry.npmjs.org/' }, integrity, tarball, visibility: 'public' };
	}

	/**
	 * An edge of the graph. A peer edge names the node in whose context it was resolved.
	 */
	static edge(from, to, kind = 'dependency', context) {
		return Object.assign({ from, to, kind, range: '*' }, kind === 'peer' ? { context } : {});
	}

	/**
	 * Sets the digest of a graph to the one of its canonical form, after a check changed it
	 */
	static seal(graph) {
		const canonical = value => {
			if (value instanceof Array) return `[${value.map(canonical).join(',')}]`;
			if (value === null || typeof value !== 'object') return JSON.stringify(value);
			return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
		};
		const { digest, ...document } = graph;
		graph.digest = `sha256-${createHash('sha256').update(canonical(document)).digest('hex')}`;
		return graph;
	}

	/**
	 * The `beyond-graph/1` input, valid against the graph contract. The renderer reaches the library through
	 * a peer edge resolved in the context of the application.
	 */
	get graph() {
		const APP = 'npm:@fixture/app@1.0.0';
		const nodes = Object.fromEntries([...this.#packages].map(([key, { name, version }]) => [key, Store.node(name, version)]));
		const edges = [
			Store.edge(APP, 'npm:@fixture/ui@2.0.0'),
			Store.edge(APP, 'npm:fake-react@18.0.0'),
			Store.edge(APP, 'npm:fake-react-dom@18.0.0'),
			Store.edge('npm:fake-react-dom@18.0.0', 'npm:fake-react@18.0.0', 'peer', APP)
		].filter(({ from, to }) => nodes[from] && nodes[to]);
		const roots = [{ name: '@fixture/app', range: '1.0.0', node: APP, targets: ['web'] }];
		return Store.seal({ protocol: 'beyond-graph/1', roots, nodes, edges, overrides: [], lock: { reused: false }, exceptions: [], diagnostics: [] });
	}

	async create() {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-store-')));
		await this.copy('npm:@fixture/app@1.0.0', '@fixture/app', '1.0.0', 'app');
		await this.copy('npm:@fixture/ui@2.0.0', '@fixture/ui', '2.0.0', 'ui');
		await this.copy('npm:fake-react@18.0.0', 'fake-react', '18.0.0', 'fake-react');
		await this.copy('npm:fake-react-dom@18.0.0', 'fake-react-dom', '18.0.0', 'fake-react-dom');
		return this;
	}

	/**
	 * Adds a package to the store from a checked-in fixture, copied into the directory of its node. The
	 * fixture itself is never written.
	 *
	 * @param fixture The directory under `./fixtures/`; the directory of the node by default
	 */
	async copy(key, name, version, directory, fixture = directory) {
		await cp(join(FIXTURES, fixture), join(this.#root, directory), { recursive: true });
		return this.add(key, name, version, directory);
	}

	/**
	 * Adds a package to the store, or replaces the directory of a node
	 *
	 * @param files Its files by relative path, for a small package a check writes itself; omitted when the
	 *   directory is filled by the caller or by `copy()`
	 */
	async add(key, name, version, directory, files = {}) {
		this.#packages.set(key, { name, version, directory });
		for (const [file, content] of Object.entries(files)) await this.write(directory, file, content);
		return join(this.#root, directory);
	}

	async write(directory, file, content) {
		const target = join(this.#root, directory, file);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content);
	}

	file(...parts) {
		return join(this.#root, ...parts);
	}

	/**
	 * Every file of the store, which is how a check shows that an operation wrote nothing
	 */
	async listing() {
		const entries = await readdir(this.#root, { recursive: true, withFileTypes: true });
		return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
	}

	destroy() {
		return rm(this.#root, { recursive: true, force: true });
	}
}

/**
 * The compiler the validations select: the Beyond fork when `BEYOND_ESBUILD` names its checkout and it was
 * laid out as a package, otherwise the `esbuild` this repository has installed, selected by name. Either
 * way the selection is explicit, and every inventory and output reports which one ran.
 */
export class Selected {
	static get compiler() {
		const { BEYOND_ESBUILD } = process.env;
		const fork = BEYOND_ESBUILD && join(BEYOND_ESBUILD, 'beyond/.cache/npm/node_modules/esbuild/lib/main.js');
		return fork && existsSync(fork) ? pathToFileURL(fork).href : 'esbuild';
	}
}
