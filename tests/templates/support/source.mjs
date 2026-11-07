/**
 * What CDN's source check (`beyond-source-checks/1`) and its preparation ask of this implementation for one
 * revision, written here against the public modules they call, with the inputs CDN gives them: the conditions
 * `{platform: 'browser', environment: 'production'}` for a template that runs on the web and `{platform: 'node', …}`
 * for one that runs on Node (a backend target), the `esbuild` compiler, the `esm` format and a confined compilation. CDN's own unit operations (`src/runners/unit/operations/check.mjs`, `compile.mjs`, `analyze.mjs`
 * and `generate.mjs` in its repository) are the reference; this file follows them and adds nothing of its own.
 *
 * - `modules`: the public modules the revision publishes, by opening its package confined (`Pinned`).
 * - `check`: every TypeScript file of the revision, each in the program of the deepest published module directory
 *   that holds it, or of the package root, checked by `Diagnostics.check` with every other package's types.
 * - `compile`: every public module of the revision traced together (`Analysis.measured`), and every module and
 *   stylesheet of the revision that the inventory lists generated (`Generation.unit`).
 * - `prepare`: every item of that inventory generated, the dependencies' included, as a preparation does.
 */
import { readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, posix, relative, sep } from 'node:path';
import { Analysis, Pinned } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';
import { Diagnostics } from '@beyond-js/packages/diagnostics';

export class SourceCheck {
	/** The conditions of a CDN target by the platform its template names */
	static CONDITIONS = { web: { platform: 'browser', environment: 'production' }, node: { platform: 'node', environment: 'production' } };

	#store;
	#compiler;
	#conditions;

	/**
	 * @param {import('./store.mjs').Store} store
	 * @param {string} compiler The esbuild compiler selection
	 * @param {'web' | 'node'} platform What the template runs on
	 */
	constructor(store, compiler, platform = 'web') {
		this.#store = store;
		this.#compiler = compiler;
		this.#conditions = SourceCheck.CONDITIONS[platform];
	}

	get #options() {
		const { graph, sources } = this.#store;
		return { graph, sources, conditions: this.#conditions, format: 'esm', compiler: this.#compiler, confined: true };
	}

	/**
	 * @returns {Promise<{directory: string, entry: string, subpath: string, specifier: string}[]>}
	 */
	async modules() {
		const { graph, sources, key } = this.#store;
		const node = graph.nodes[key];
		const root = realpathSync(this.#store.directory);
		const pinned = new Pinned(graph, sources, this.#conditions, true);
		try {
			const { opened } = await pinned.open(key);
			if (!opened) return [];
			const entries = await opened.entries(pinned.conditions, '');
			return [...entries].map(([file, specifier]) => {
				const entry = relative(root, realpathSync(file)).split(sep).join('/');
				const subpath = specifier.slice(opened.name.length + 1) || '.';
				const directory = dirname(entry) === '' ? '.' : dirname(entry);
				return { directory, entry, subpath, specifier: `${node.name}@${node.version}${specifier.slice(node.name.length)}` };
			});
		} finally {
			pinned.destroy();
		}
	}

	/**
	 * @returns {Promise<{programs: object[], files: string[]}>} Every program's `Diagnostics.check` result
	 */
	async check() {
		const { graph, key } = this.#store;
		const node = graph.nodes[key];
		const root = realpathSync(this.#store.directory);
		const files = await SourceCheck.#typescript(root);
		const programs = [];
		for (const program of SourceCheck.#programs(files, await this.modules())) {
			const result = await Diagnostics.check({
				module: { package: node.name, version: node.version, root, subpath: program.subpath === '.' ? '.' : `./${program.subpath}`, entry: program.entry, path: program.directory, files: program.files },
				conditions: this.#conditions,
				dependencies: { packages: this.#store.dependencies },
				limits: { ms: 240_000, files: 2000, diagnostics: 100_000 }
			});
			programs.push({ ...program, result });
		}
		return { programs, files };
	}

	/**
	 * @param {'own' | 'all'} scope The revision's modules and stylesheets (the check), or every item (a preparation)
	 */
	async compile(scope) {
		const entries = (await this.modules()).map(({ specifier }) => ({ specifier, target: 'check' }));
		const { inventory } = await Analysis.measured({ ...this.#options, entries, declared: {} });
		const items = inventory.items.filter(item => scope === 'all' || (item.package === this.#store.key && ['module', 'style'].includes(item.kind)));
		const generated = [];
		for (const item of items) generated.push({ item, result: await Generation.unit({ ...this.#options, item }) });
		return { inventory, generated };
	}

	// Every `.ts` and `.tsx` file of the package, `node_modules` and links left out, as the check lists them
	static async #typescript(root) {
		const entries = await readdir(root, { withFileTypes: true, recursive: true });
		return entries
			.filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
			.map(entry => relative(root, `${entry.parentPath ?? entry.path}${sep}${entry.name}`).split(sep).join(posix.sep))
			.filter(file => !file.split('/').includes('node_modules'))
			.sort();
	}

	// The program of each file: the deepest published module directory that holds it, or the package root
	static #programs(files, modules) {
		const ordered = modules.filter(module => module.directory !== '.').sort((left, right) => right.directory.length - left.directory.length);
		const groups = new Map();
		for (const file of files) {
			const module = ordered.find(candidate => file.startsWith(`${candidate.directory}/`));
			const directory = module?.directory ?? '.';
			if (!groups.has(directory)) groups.set(directory, { directory, subpath: module?.subpath ?? '.', preferred: module?.entry, files: [] });
			groups.get(directory).files.push(file);
		}
		return [...groups.values()].map(({ preferred, ...group }) => ({
			...group,
			entry: preferred && group.files.includes(preferred) ? preferred : (group.files.find(file => !file.endsWith('.d.ts')) ?? group.files[0])
		}));
	}
}
