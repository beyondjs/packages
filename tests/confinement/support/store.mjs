/**
 * The pinned inputs of the confinement validation.
 *
 * The fixture packages are copied into a unique temporary directory, each under `packages/`, beside a copy of
 * `fixtures/outside/`, the files they reach for. Two things a checked-in fixture cannot carry are made in the
 * copy: the absolute location of `outside/` replaces `__OUTSIDE__` in the files that name it, and the
 * symbolic links of `Store.LINKS` are created. The installed packages the fixtures reference (`Store.INSTALLED`:
 * the runtime the composed modules import, and the frameworks their components import) are copied from the
 * installation, as a fetch of their sources would leave them. A package depends on the ones its manifest
 * names. Nothing is downloaded and the checked-in fixtures are never written.
 */
import { cp, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '../fixtures');
const installed = resolve(process.env.BEYOND_MODULES || join(here, '../../../node_modules'));

export class Store {
	/**
	 * The links the copy carries: the path of the link in the package, and what it leads to under `outside/`
	 */
	static LINKS = [
		['hostile-inputs/linked/styles.css', 'secret.css'],
		['hostile-tailwind/sources/parts', 'parts'],
		['hostile-esbuild/linked.json', 'secret.json'],
		['hostile-assets/linked.txt', 'secret.txt']
	];

	static TEXT = /\.(css|scss|js|cjs|mjs|ts|tsx|json)$/;

	/**
	 * The installed packages the fixtures reference
	 */
	static INSTALLED = ['@beyond-js/kernel', 'vue', 'svelte'];

	#root;
	get root() {
		return this.#root;
	}

	get outside() {
		return join(this.#root, 'outside');
	}

	#packages = new Map();

	get sources() {
		return Object.fromEntries([...this.#packages].map(([key, { directory }]) => [key, directory]));
	}

	/**
	 * A package depends on the packages of the store its manifest names
	 */
	get graph() {
		const nodes = Object.fromEntries([...this.#packages].map(([key, { name, version }]) => [key, Store.#node(key, name, version)]));
		const edges = [...this.#packages].flatMap(([from, { dependencies }]) =>
			dependencies.map(name => this.key(name)).filter(to => to && to !== from).map(to => ({ from, to, kind: 'dependency', range: '*' }))
		);
		return { protocol: 'beyond-graph/1', roots: [], nodes, edges, overrides: [], lock: { reused: false }, exceptions: [], diagnostics: [] };
	}

	static #node(key, name, version) {
		const integrity = `sha512-${createHash('sha512').update(key).digest('base64')}`;
		return { name, version, origin: { provider: 'npm', registry: 'https://registry.npmjs.org/' }, integrity, visibility: 'public' };
	}

	key(name) {
		return [...this.#packages].find(([, one]) => one.name === name)?.[0];
	}

	async #add(from, directory) {
		await cp(from, directory, { recursive: true });
		const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
		const { name, version } = manifest;
		this.#packages.set(`npm:${name}@${version}`, { name, version, directory, dependencies: Object.keys(manifest.dependencies ?? {}) });
	}

	/**
	 * Writes the location of `outside/` where a copied file names it
	 */
	async #substitute(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
			if (!entry.isFile() || !Store.TEXT.test(entry.name)) continue;
			const file = join(entry.parentPath ?? entry.path, entry.name);
			const content = await readFile(file, 'utf8');
			content.includes('__OUTSIDE__') && (await writeFile(file, content.replaceAll('__OUTSIDE__', this.outside)));
		}
	}

	async create() {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-confinement-')));
		await cp(join(fixtures, 'outside'), this.outside, { recursive: true });

		for (const group of ['hostile', 'clean']) {
			for (const name of (await readdir(join(fixtures, group))).sort()) {
				await this.#add(join(fixtures, group, name), join(this.#root, 'packages', `${group}-${name}`));
			}
		}
		await this.#substitute(join(this.#root, 'packages'));
		for (const [link, target] of Store.LINKS) await symlink(join(this.outside, target), join(this.#root, 'packages', link));

		for (const name of Store.INSTALLED) {
			const from = join(installed, ...name.split('/'));
			if (!existsSync(join(from, 'package.json'))) throw new Error(`A package the fixtures reference is not installed: ${from}`);
			await this.#add(from, join(this.#root, 'packages', `installed-${name.replace(/[^\w.-]+/g, '_')}`));
		}
		return this;
	}
}
