/**
 * The pinned inputs one template is checked with: the template copied, as a capture would carry it, into a unique
 * temporary directory, and the packages its manifest depends on (dependencies and development dependencies, as a
 * source check pins them) installed from the npm registry into a directory of their own, each package one node of
 * the graph with its extracted root. The checked-in template is only read.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class Store {
	/** How long the installation of a template's dependencies may take */
	static INSTALL_MS = 300_000;

	#root;
	#packages = new Map();
	#key;

	/** The node key of the template's package */
	get key() {
		return this.#key;
	}

	get sources() {
		return Object.fromEntries([...this.#packages].map(([key, { directory }]) => [key, directory]));
	}

	get graph() {
		const nodes = Object.fromEntries([...this.#packages].map(([key, { name, version }]) => [key, Store.#node(key, name, version)]));
		const edges = [...this.#packages].flatMap(([from, { requires }]) =>
			requires.map(({ name, kind }) => ({ from, to: this.#find(name), kind, range: '*', name })).filter(edge => edge.to && edge.to !== from)
		);
		return { protocol: 'beyond-graph/1', roots: [this.#key], nodes, edges, overrides: [], lock: { reused: false }, exceptions: [], diagnostics: [] };
	}

	/** The extracted root of the template's package */
	get directory() {
		return this.#packages.get(this.#key).directory;
	}

	/** Every other package of the graph by name, as a source check supplies their types */
	get dependencies() {
		return Object.fromEntries([...this.#packages].filter(([key]) => key !== this.#key).map(([, { name, directory }]) => [name, directory]));
	}

	static #node(key, name, version) {
		const integrity = `sha512-${createHash('sha512').update(key).digest('base64')}`;
		return { name, version, origin: { provider: 'npm', registry: 'https://registry.npmjs.org/' }, integrity, visibility: 'public' };
	}

	#find(name) {
		return [...this.#packages].find(([, one]) => one.name === name)?.[0];
	}

	async #add(directory, root = false) {
		const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
		const kinds = [['dependencies', 'dependency'], ['peerDependencies', 'peer'], ...(root ? [['devDependencies', 'development']] : [])];
		const requires = kinds.flatMap(([member, kind]) => Object.keys(manifest[member] ?? {}).map(name => ({ name, kind })));
		const key = `npm:${manifest.name}@${manifest.version}`;
		this.#packages.set(key, { name: manifest.name, version: manifest.version, directory, requires });
		return key;
	}

	/**
	 * @param {string} template The directory of the checked-in template
	 */
	async create(template) {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-templates-')));
		const directory = join(this.#root, 'packages', 'template');
		await cp(template, directory, { recursive: true });
		this.#key = await this.#add(directory, true);

		const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
		const wanted = { ...manifest.dependencies, ...manifest.devDependencies };
		if (Object.keys(wanted).length) await this.#install(wanted);
		return this;
	}

	async #install(dependencies) {
		const directory = join(this.#root, 'install');
		await mkdir(directory);
		await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'install', private: true, dependencies }));
		const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'];
		await Store.#run('npm', args, directory);

		const modules = join(directory, 'node_modules');
		for (const entry of await readdir(modules)) {
			if (entry.startsWith('.')) continue;
			const names = entry.startsWith('@') ? (await readdir(join(modules, entry))).map(name => `${entry}/${name}`) : [entry];
			for (const name of names) {
				const root = join(modules, ...name.split('/'));
				// A version installed twice would be a second node: the graph here holds one version of each name
				if (existsSync(join(root, 'node_modules'))) throw new Error(`"${name}" carries nested dependencies, which this store does not pin`);
				await this.#add(root);
			}
		}
	}

	static #run(command, args, cwd) {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
			let errors = '';
			child.stderr.on('data', chunk => (errors += chunk));
			const timer = setTimeout(() => (child.kill('SIGTERM'), reject(new Error(`${command} ${args[0]} did not end within ${Store.INSTALL_MS} ms`))), Store.INSTALL_MS);
			child.once('error', error => (clearTimeout(timer), reject(error)));
			child.once('exit', code => {
				clearTimeout(timer);
				code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} ended with ${code}: ${errors.slice(-2000)}`));
			});
		});
	}

	async remove() {
		this.#root && (await rm(this.#root, { recursive: true, force: true }));
	}
}
