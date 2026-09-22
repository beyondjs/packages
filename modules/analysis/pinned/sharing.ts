import { Bundle, Compiler, type IBundleRequest } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import type { IResolvedExport } from '@beyond-js/packages/publication';
import { Interop } from './interop';
import { relative, sep } from 'path';

/**
 * One public subpath of a package, as the scan of the package saw it
 */
export /*bundle*/ interface IScanned {
	subpath: string;
	specifier: string;

	/**
	 * The entry point file, absolute, and relative to the package root with forward slashes
	 */
	entry: string;
	relative: string;

	/**
	 * Every file the subpath bundles when nothing of the package is kept external, relative to the root
	 */
	inputs: Set<string>;
	exports: string[];

	/**
	 * The modules the subpath re-exports with a star and the compiler did not read, which is why its names
	 * cannot be listed
	 */
	stars: string[];
}

/**
 * How a subpath is delivered: on its own, as the carrier of the subpaths it contains, or as a facade over
 * its carrier
 */
export /*bundle*/ type RoleType = { kind: 'own' } | { kind: 'carrier'; contained: IScanned[] } | { kind: 'facade'; carrier: IScanned; index: number };

export /*bundle*/ interface ISharingSettings extends Pick<IBundleRequest, 'platform' | 'environment' | 'conditions' | 'mode'> {
	root: string;
	name: string;
	manifest: Record<string, any>;
	compiler: Compiler;

	/**
	 * The public subpaths of the package, as its manifest declares them
	 */
	subpaths: string[];

	/**
	 * Where a public subpath resolves for the conditions of the caller. The caller owns that resolution, so
	 * the plan sees the same target as the module it is planning for.
	 */
	resolve: (subpath: string) => IResolvedExport;

	/**
	 * Locates the file of an exports target, or undefined
	 */
	file: (target: string) => string | undefined;
}

/**
 * The public subpaths of an ordinary npm package that share internal files, and how they are delivered so
 * that a browser holds one copy of that state.
 *
 * Each public subpath of such a package is compiled as one ES module, with the other subpaths kept
 * as references. Two subpaths whose graphs share a file would each carry a copy of it, and a file that
 * holds state, such as the runtime of a view framework, must not be copied: a component compiled against
 * `svelte/internal/client` and a view mounted with `mount` from `svelte` have to run on one runtime. When
 * the entry point of a subpath is reached by the graph of another, that other subpath carries it: the
 * carrier is compiled from an entry that keeps its own API and re-exports the API of each subpath it
 * contains under a name of its own, and each contained subpath becomes a facade that renames those back.
 * A facade keeps the public identity of the subpath and its live bindings, and adds nothing private: what
 * a page loads is still public modules only.
 *
 * The union names every re-export instead of starring it, so a name two subpaths export is carried for
 * both rather than becoming ambiguous and dropped by the compiler without saying so. A subpath the union
 * cannot name — one that re-exports an external module in turn, or whose API has a name that is not an
 * identifier — stays on its own with its copy.
 *
 * The plan is a fact of the package, of the conditions and of the compiler, all of which are inputs of the
 * compatibility key of an output, so whoever traces a package and whoever generates its outputs later
 * reach the same roles without recording them.
 */
export /*bundle*/ class Sharing {
	#plans: Map<string, Promise<Plan>> = new Map();

	plan(settings: ISharingSettings): Promise<Plan> {
		const { identity } = settings.compiler;
		const compiler = [identity?.specifier, identity?.version, identity?.assigned];
		const key = JSON.stringify([settings.root, settings.platform, settings.mode ?? '', settings.environment ?? '', compiler]);
		!this.#plans.has(key) && this.#plans.set(key, Plan.create(settings));
		return this.#plans.get(key);
	}
}

export /*bundle*/ class Plan {
	#settings: ISharingSettings;
	#roles: Map<string, RoleType> = new Map();

	private constructor(settings: ISharingSettings) {
		this.#settings = settings;
	}

	role(subpath: string): RoleType {
		return this.#roles.get(subpath) ?? { kind: 'own' };
	}

	static #relative(root: string, file: string): string {
		return `./${relative(root, file).split(sep).join('/')}`;
	}

	/**
	 * The name a carrier publishes one export of the subpath it contains under. It belongs to no package,
	 * so nothing it could collide with is a name the union already carries.
	 */
	static #alias(index: number, name: string): string {
		return `__beyond_${index}_${name}`;
	}

	/**
	 * Whether the union can name the API of a subpath: a subpath that re-exports an external module does
	 * not say what it exports, and a name that is not an identifier cannot be aliased
	 */
	static nameable(scanned: IScanned): boolean {
		return !scanned.stars.length && scanned.exports.every(name => /^[A-Za-z_$][\w$]*$/.test(name));
	}

	/**
	 * The entry the carrier is compiled from: its own API, and then the API of every subpath it contains,
	 * each name under an alias of its own. A subpath that exports nothing is imported, so that whatever it
	 * does when it is evaluated still happens.
	 */
	union(subpath: string): string | undefined {
		const role = this.role(subpath);
		if (role.kind !== 'carrier') return;

		const self = this.#scanned(subpath);
		const lines = [`export * from ${JSON.stringify(self.relative)};`];
		self.exports.includes('default') && lines.push(`export { default } from ${JSON.stringify(self.relative)};`);

		role.contained.forEach((one, index) => {
			const from = JSON.stringify(one.relative);
			if (!one.exports.length) return void lines.push(`import ${from};`);
			const names = one.exports.map(name => `${name} as ${Plan.#alias(index, name)}`);
			lines.push(`export { ${names.join(', ')} } from ${from};`);
		});
		return `${lines.join('\n')}\n`;
	}

	/**
	 * The module of a contained subpath: the API its carrier publishes for it, under the names of the
	 * subpath itself
	 */
	facade(subpath: string): string | undefined {
		const role = this.role(subpath);
		if (role.kind !== 'facade') return;

		const carrier = JSON.stringify(role.carrier.specifier);
		const { exports } = this.#scanned(subpath);
		if (!exports.length) return `import ${carrier};\n`;

		const names = exports.map(name => `${Plan.#alias(role.index, name)} as ${name}`);
		return `export { ${names.join(', ')} } from ${carrier};\n`;
	}

	/**
	 * The entry files that stay external when a subpath is compiled: every other subpath, except the ones
	 * a carrier contains, which it bundles
	 */
	externals(subpath: string, entries: Map<string, string>): Map<string, string> {
		const role = this.role(subpath);
		if (role.kind !== 'carrier') return entries;
		const bundled = new Set(role.contained.map(one => one.entry));
		return new Map([...entries].filter(([file]) => !bundled.has(file)));
	}

	#scans: Map<string, IScanned> = new Map();
	#scanned(subpath: string): IScanned {
		return this.#scans.get(subpath);
	}

	static async create(settings: ISharingSettings): Promise<Plan> {
		const plan = new Plan(settings);
		const subpaths = settings.subpaths.filter(subpath => subpath !== './package.json');
		if (subpaths.length < 2) return plan;

		for (const subpath of subpaths) {
			const scanned = await plan.#scan(subpath);
			scanned && plan.#scans.set(subpath, scanned);
		}
		await plan.#assign();
		return plan;
	}

	async #bundle(subpath: string, entry: string, facade?: string, entries = new Map<string, string>()) {
		const { root, compiler, platform, environment, conditions, mode } = this.#settings;
		return new Bundle(compiler, { root, entry, facade, entries, package: { root, subpath }, platform, environment, conditions, mode }).run();
	}

	/**
	 * Bundles a subpath with nothing of the package kept external, which says which files it reaches
	 */
	async #scan(subpath: string): Promise<IScanned | undefined> {
		const { root, name, manifest, resolve, file } = this.#settings;
		const resolved = resolve(subpath);
		const entry = resolved.target && !resolved.target.endsWith('.json') && !resolved.target.endsWith('.css') && file(resolved.target);
		if (!entry) return;
		if (new Interop(entry, manifest.type, resolved.via).format !== 'esm') return;

		const { bundled } = await this.#bundle(subpath, entry);
		if (!bundled) return;
		const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
		const inputs = new Set(bundled.inputs.map(input => (input.startsWith('.') ? input : `./${input}`)));
		return { subpath, specifier, entry, relative: Plan.#relative(root, entry), inputs, exports: bundled.exports, stars: bundled.stars };
	}

	/**
	 * The largest graphs carry the subpaths whose entry points they reach; a union the compiler refuses, or
	 * one that does not publish everything it promised, leaves the subpaths it was built for on their own
	 */
	async #assign() {
		const scanned = [...this.#scans.values()].sort((a, b) => b.inputs.size - a.inputs.size || a.subpath.localeCompare(b.subpath));
		const assigned = new Set<string>();

		for (const carrier of scanned) {
			if (assigned.has(carrier.subpath)) continue;
			const reached = (one: IScanned) => one !== carrier && !assigned.has(one.subpath) && carrier.inputs.has(one.relative);
			const contained = scanned.filter(one => reached(one) && Plan.nameable(one));
			if (!contained.length) continue;

			this.#roles.set(carrier.subpath, { kind: 'carrier', contained });
			const { bundled } = await this.#bundle(carrier.subpath, carrier.entry, this.union(carrier.subpath));
			if (!bundled || !this.#publishes(carrier, contained, new Set(bundled.exports))) {
				this.#roles.delete(carrier.subpath);
				continue;
			}

			assigned.add(carrier.subpath);
			contained.forEach((one, index) => {
				assigned.add(one.subpath);
				this.#roles.set(one.subpath, { kind: 'facade', carrier, index });
			});
		}
	}

	/**
	 * Whether a union publishes what its facades and the carrier itself promise: the alias of every name of
	 * every contained subpath, and the API the carrier has on its own
	 */
	#publishes(carrier: IScanned, contained: IScanned[], names: Set<string>): boolean {
		const own = carrier.exports.every(name => names.has(name));
		const carried = contained.every((one, index) => one.exports.every(name => names.has(Plan.#alias(index, name))));
		return own && carried;
	}
}
