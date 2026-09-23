/**
 * The pinned inputs of the preparation validation: an application authored with Beyond, the Widgets package
 * and the framework controllers it uses, the development runtime and the frameworks they depend on.
 *
 * Nothing is downloaded. The Beyond packages are copied from the checkouts of the suite, which is what a
 * fetch of their published sources would leave behind, and the frameworks are copied from the installed
 * packages of this repository. What the graph pins is what a resolution would have pinned.
 */
import { cp, mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suite = resolve(process.env.BEYOND_SUITE || join(here, '../../..'));
const installed = resolve(process.env.BEYOND_MODULES || join(here, '../../node_modules'));

/**
 * Each Beyond package of the toolchain: where its sources are in the suite, and the publication form its
 * manifest must carry for a consumer to prepare it as Beyond sources
 */
const BEYOND = [
	{ name: '@beyond-js/widgets', checkout: 'widgets/widgets/src' },
	{ name: '@beyond-js/react-19-widgets', checkout: 'widgets/react-widgets/react-19' },
	{ name: '@beyond-js/vue-widgets', checkout: 'widgets/vue-widgets' },
	{ name: '@beyond-js/svelte-widgets', checkout: 'widgets/svelte-widgets' },
	{ name: '@beyond-js/local-2026', checkout: 'local-2026' },
	{ name: '@beyond-js/kernel', modules: '@beyond-js/kernel' }
];

/** The ordinary npm packages the controllers depend on */
const NPM = [
	'react', 'react-dom', 'scheduler',
	'vue', '@vue/runtime-dom', '@vue/runtime-core', '@vue/reactivity', '@vue/shared',
	'svelte', 'clsx', 'esm-env'
];

export class Store {
	#root;
	get root() {
		return this.#root;
	}

	#packages = new Map();

	/**
	 * The name and version of every pinned package, by node key
	 */
	get pinned() {
		return new Map([...this.#packages].map(([key, { name, version }]) => [key, `${name}@${version}`]));
	}

	get sources() {
		return Object.fromEntries([...this.#packages].map(([key, { directory }]) => [key, directory]));
	}

	key(name) {
		return [...this.#packages].find(([, one]) => one.name === name)?.[0];
	}

	static NPM = { provider: 'npm', registry: 'https://registry.npmjs.org/' };

	/**
	 * @param origin The origin the node was pinned from; npm unless a validation pins another source
	 * @param integrity What the fetch verified; derived from the identity when none is given
	 */
	static node(name, version, origin = Store.NPM, integrity) {
		integrity ??= `sha512-${createHash('sha512').update(`${origin.provider}:${name}@${version}`).digest('base64')}`;
		return { name, version, origin, integrity, visibility: 'public' };
	}

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
	 * Every package depends on every other one here: the graph a resolution pins is not what this validation
	 * checks, and a complete set of edges lets any reference of any of them land
	 */
	get graph() {
		const keys = [...this.#packages.keys()];
		const nodes = Object.fromEntries([...this.#packages].map(([key, { name, version, origin, integrity }]) => [key, Store.node(name, version, origin, integrity)]));
		const edges = keys.flatMap(from => keys.filter(to => to !== from).map(to => ({ from, to, kind: 'dependency', range: '*' })));
		const app = this.key('@fixture/cards');
		const roots = [{ name: '@fixture/cards', range: '1.0.0', node: app, targets: ['web'] }];
		return Store.seal({ protocol: 'beyond-graph/1', roots, nodes, edges, overrides: [], lock: { reused: false }, exceptions: [], diagnostics: [] });
	}

	/**
	 * Copies a package into the store and pins it
	 */
	async #add(name, from) {
		return (await this.add(name, from)).directory;
	}

	/**
	 * Copies a package into the store and pins it from an origin, which is how a validation places the same
	 * name and version from two sources in one store
	 *
	 * @param origin `{provider, registry}` of the node; npm by default
	 * @param integrity The integrity the node pins; derived from its key when none is given
	 * @returns The node key and the directory the package was copied to
	 */
	async add(name, from, origin = Store.NPM, integrity) {
		const manifest = JSON.parse(await readFile(join(from, 'package.json'), 'utf8'));
		const version = manifest.version ?? '0.0.0';
		const key = `${origin.provider}:${name}@${version}`;
		const directory = join(this.#root, `${origin.provider}_${name.replace(/[^\w.-]+/g, '_')}`);
		await cp(from, directory, { recursive: true, filter: source => !/[\\/]node_modules$/.test(source) && !/[\\/]\.git$/.test(source) });
		this.#packages.set(key, { name, version, directory, origin, integrity });
		return { key, directory };
	}

	/**
	 * Unpins a package, so a graph holds only the source of a name and version a validation selects
	 */
	remove(key) {
		this.#packages.delete(key);
	}

	/**
	 * Declares the publication form of a Beyond package whose manifest does not carry it. A package that is
	 * published without it is read as an ordinary npm package, which the validation checks separately.
	 */
	static async declare(directory) {
		const file = join(directory, 'package.json');
		const manifest = JSON.parse(await readFile(file, 'utf8'));
		const beyond = manifest.beyond ?? {};
		if (beyond.publication) return false;

		manifest.beyond = { ...beyond, publication: { protocol: 'beyond-publication/1', form: 'source' } };
		await writeFile(file, JSON.stringify(manifest, null, '\t'));
		return true;
	}

	async create() {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-preparation-')));

		const missing = [];
		for (const { name, checkout, modules } of BEYOND) {
			const from = checkout ? join(suite, checkout) : join(installed, modules);
			if (!existsSync(join(from, 'package.json'))) {
				missing.push(`${name} (${from})`);
				continue;
			}
			await Store.declare(await this.#add(name, from));
		}
		for (const name of NPM) {
			const from = join(installed, ...name.split('/'));
			existsSync(join(from, 'package.json')) ? await this.#add(name, from) : missing.push(`${name} (${from})`);
		}
		if (missing.length) throw new Error(`The preparation store is missing: ${missing.join(', ')}`);

		const application = join(this.#root, 'cards');
		await mkdir(application, { recursive: true });
		await cp(join(here, 'fixture'), application, { recursive: true });
		const manifest = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
		this.#packages.set(`npm:@fixture/cards@${manifest.version}`, { name: '@fixture/cards', version: manifest.version, directory: application });
		return this;
	}
}
