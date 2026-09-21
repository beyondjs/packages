import { Bundle, Compiler, type IBundleRequest } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Exports } from '@beyond-js/packages/publication';
import { Interop } from '@beyond-js/packages/analysis';
import { relative, sep } from 'path';

/**
 * One public subpath of an installed package, as the scan of the package saw it
 */
export interface IScanned {
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
}

/**
 * How a subpath is delivered: on its own, as the carrier of the subpaths it contains, or as a facade over
 * its carrier
 */
export type RoleType = { kind: 'own' } | { kind: 'carrier'; contained: IScanned[] } | { kind: 'facade'; carrier: IScanned; index: number };

export interface ISettings extends Pick<IBundleRequest, 'platform' | 'environment' | 'conditions' | 'mode'> {
	root: string;
	name: string;
	manifest: Record<string, any>;
	exports: Exports;
	compiler: Compiler;

	/**
	 * Locates the file of an exports target, or undefined
	 */
	file: (target: string) => string | undefined;
}

/**
 * The public subpaths of an installed package that share internal files, and how they are delivered so
 * that a browser holds one copy of that state.
 *
 * Each public subpath of an installed package is compiled as one ES module, with the other subpaths kept
 * as references. Two subpaths whose graphs share a file would each carry a copy of it, and a file that
 * holds state, such as the runtime of a view framework, must not be copied: a component compiled against
 * `svelte/internal/client` and a view mounted with `mount` from `svelte` have to run on one runtime. When
 * the entry point of a subpath is reached by the graph of another, that other subpath carries it: the
 * carrier is compiled from an entry that re-exports both, and the contained subpath becomes a facade that
 * re-exports the carrier. A facade keeps the public identity of the subpath and its live bindings, and
 * adds nothing private: what a page loads is still public modules only. A subpath whose names the union
 * cannot all carry, because two of them are ambiguous, stays on its own with its copy.
 */
export class Sharing {
	#plans: Map<string, Promise<Plan>> = new Map();

	plan(settings: ISettings): Promise<Plan> {
		const key = JSON.stringify([settings.root, settings.platform, settings.mode ?? '', settings.environment ?? '']);
		!this.#plans.has(key) && this.#plans.set(key, Plan.create(settings));
		return this.#plans.get(key);
	}
}

export class Plan {
	#settings: ISettings;
	#roles: Map<string, RoleType> = new Map();

	private constructor(settings: ISettings) {
		this.#settings = settings;
	}

	role(subpath: string): RoleType {
		return this.#roles.get(subpath) ?? { kind: 'own' };
	}

	static #relative(root: string, file: string): string {
		return `./${relative(root, file).split(sep).join('/')}`;
	}

	/**
	 * The entry the carrier is compiled from: its own API, then the API of every subpath it contains, with
	 * the default export of each one given a name of its own, because `export *` never carries a default
	 */
	union(subpath: string): string | undefined {
		const role = this.role(subpath);
		if (role.kind !== 'carrier') return;
		const self = this.#scanned(subpath);
		const lines = [`export * from ${JSON.stringify(self.relative)};`];
		self.exports.includes('default') && lines.push(`export { default } from ${JSON.stringify(self.relative)};`);
		role.contained.forEach((one, index) => {
			lines.push(`export * from ${JSON.stringify(one.relative)};`);
			one.exports.includes('default') && lines.push(`export { default as __beyond_default_${index} } from ${JSON.stringify(one.relative)};`);
		});
		return `${lines.join('\n')}\n`;
	}

	/**
	 * The module of a contained subpath: everything its carrier exports, under the identity of the subpath
	 */
	facade(subpath: string): string | undefined {
		const role = this.role(subpath);
		if (role.kind !== 'facade') return;
		const carrier = JSON.stringify(role.carrier.specifier);
		const lines = [`export * from ${carrier};`];
		this.#scanned(subpath).exports.includes('default') && lines.push(`export { __beyond_default_${role.index} as default } from ${carrier};`);
		return `${lines.join('\n')}\n`;
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

	static async create(settings: ISettings): Promise<Plan> {
		const plan = new Plan(settings);
		const { exports } = settings;
		const subpaths = exports.subpaths.filter(subpath => subpath !== './package.json');
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
		const { root, name, manifest, exports, file, platform, mode } = this.#settings;
		const resolved = exports.resolve(subpath, platform === 'web' ? 'browser' : platform, mode);
		const entry = resolved.target && !resolved.target.endsWith('.json') && !resolved.target.endsWith('.css') && file(resolved.target);
		if (!entry) return;
		if (new Interop(entry, manifest.type, resolved.via).format !== 'esm') return;

		const { bundled } = await this.#bundle(subpath, entry);
		if (!bundled) return;
		const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
		const inputs = new Set(bundled.inputs.map(input => (input.startsWith('.') ? input : `./${input}`)));
		return { subpath, specifier, entry, relative: Plan.#relative(root, entry), inputs, exports: bundled.exports };
	}

	/**
	 * The largest graphs carry the subpaths whose entry points they reach; a union that cannot carry every
	 * name of a contained subpath leaves that subpath on its own
	 */
	async #assign() {
		const scanned = [...this.#scans.values()].sort((a, b) => b.inputs.size - a.inputs.size || a.subpath.localeCompare(b.subpath));
		const assigned = new Set<string>();

		for (const carrier of scanned) {
			if (assigned.has(carrier.subpath)) continue;
			let contained = scanned.filter(one => one !== carrier && !assigned.has(one.subpath) && carrier.inputs.has(one.relative));
			if (!contained.length) continue;

			for (;;) {
				this.#roles.set(carrier.subpath, { kind: 'carrier', contained });
				const { bundled } = await this.#bundle(carrier.subpath, carrier.entry, this.union(carrier.subpath));
				const names = new Set(bundled?.exports ?? []);
				const carried = contained.filter(one => one.exports.every(name => name === 'default' || names.has(name)));
				if (!bundled || !carried.length) {
					this.#roles.delete(carrier.subpath);
					contained = [];
					break;
				}
				if (carried.length === contained.length) break;
				contained = carried;
			}

			assigned.add(carrier.subpath);
			contained.forEach((one, index) => {
				assigned.add(one.subpath);
				this.#roles.set(one.subpath, { kind: 'facade', carrier, index });
			});
		}
	}
}
