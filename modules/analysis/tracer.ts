import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Compiler, IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import type { IItem, IUnknown, IInventoryDiagnostic } from './types';
import type { Pinned } from './pinned';
import type { Opened, IPublicModule } from './pinned/opened';
import type { Toolchain } from './toolchain';
import { Target } from './pinned/target';
import { Assets } from './assets';
import { Keyed } from './keyed';
import { Specifier } from './specifier';
import { Reach, type IEdge } from './reach';

interface IPending {
	opened: Opened;
	module: IPublicModule;

	/**
	 * The package that reached the module, which is the context its peers were resolved in
	 */
	context?: string;
}

/**
 * Walks the public modules an application reaches from its entries.
 *
 * Each module is visited once. A compiled form is bundled in memory only to read what it references, and
 * its code is dropped; a distributed form is read from its manifest. References are followed along the
 * pinned graph, so the walk never leaves the packages that were fetched, and a module nothing references
 * is never opened.
 */
export /*bundle*/ class Tracer {
	#pinned: Pinned;
	#compiler: Compiler;
	#toolchain: Toolchain;
	#declared: Record<string, string[]>;

	#items: Map<string, IItem> = new Map();
	#edges: Map<string, IEdge[]> = new Map();
	#assets = new Assets();
	#pending: IPending[] = [];

	readonly unknown: IUnknown[] = [];
	readonly diagnostics: IInventoryDiagnostic[] = [];
	readonly cost = { compiled: 0, read: 0 };

	constructor(pinned: Pinned, compiler: Compiler, toolchain: Toolchain, declared: Record<string, string[]> = {}) {
		this.#pinned = pinned;
		this.#compiler = compiler;
		this.#toolchain = toolchain;
		this.#declared = declared;
	}

	#report(severity: 'error' | 'warning', specifier: string, list: IDiagnostic[]): void {
		list.forEach(({ code, message }) => this.diagnostics.push({ code, message: `Module "${specifier}": ${message}`, severity }));
	}

	/**
	 * Schedules a public module, and answers the id its item has or will have
	 */
	enqueue(opened: Opened, module: IPublicModule, context?: string): string {
		const id = Keyed.id(module.kind, opened.key, module.subpath);
		if (!this.#items.has(id)) {
			this.#items.set(id, void 0);
			this.#pending.push({ opened, module, context });
		}
		return id;
	}

	/**
	 * Visits everything that was scheduled, then relates the items to the entries
	 *
	 * @param entries The id and the application target of each entry
	 */
	async run(entries: { id: string; target: string }[]): Promise<IItem[]> {
		for (let next = this.#pending.shift(); next; next = this.#pending.shift()) await this.#visit(next);
		this.#items.forEach((item, id) => !item && this.#items.delete(id));
		this.#assets.items.forEach(item => this.#items.set(item.id, item));
		this.#assets.diagnostics.forEach(({ code, message }) => this.diagnostics.push({ code, message, severity: 'error' }));

		new Reach(this.#items, this.#edges).relate(entries);
		return [...this.#items.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
	}

	async #visit({ opened, module, context }: IPending): Promise<void> {
		const id = Keyed.id(module.kind, opened.key, module.subpath);
		const specifier = Specifier.of(opened.name, module.subpath);

		let bundled: IBundled;
		if (module.distributed) this.cost.read++;
		else {
			this.cost.compiled++;
			const result = await new Target(this.#pinned, opened, module).bundle(this.#compiler);
			if (!result.bundled) return this.#report('error', specifier, result.diagnostics);
			bundled = result.bundled;
		}

		const edges: IEdge[] = [];
		const resolution: Record<string, string> = {};
		const coded = module.distributed ? module.distributed.references : bundled.references;
		const declared = this.#dynamic(id, specifier, module, bundled).filter(name => !coded.some(reference => reference.specifier === name));
		const references = coded.map(reference => Object.assign({ declared: false }, reference)).concat(declared.map(name => ({ specifier: name, kind: <const>'lazy', declared: true })));

		for (const reference of references) {
			const landing = await this.#pinned.land(opened.key, reference.specifier, { context });
			this.#report('warning', specifier, landing.warnings);
			this.#report('error', specifier, landing.diagnostics);
			if (landing.builtin && this.#pinned.conditions.platform !== 'node') {
				this.#report('warning', specifier, [{ code: 'NODE_BUILTIN_REFERENCED', message: `"${reference.specifier}" is a Node builtin, which a browser cannot import` }]);
			}

			// Only what the code itself references decides its output; a declaration adds items, not inputs
			if (landing.opened && !reference.declared) resolution[new Specifier(reference.specifier).name] = landing.opened.key;
			if (!landing.module) continue;
			const target = this.enqueue(landing.opened, landing.module, opened.key);
			edges.push({ target, lazy: reference.kind === 'lazy', declared: reference.declared });
		}

		const paths: [string, boolean][] = module.assets.concat(opened.assets).map(path => [path, true]);
		bundled?.resources.forEach(({ path }) => paths.push([path, false]));
		for (const [path, listed] of paths) {
			const asset = await this.#assets.add(opened, path, listed);
			asset && edges.push({ target: asset, lazy: false, declared: false });
		}

		const described = this.#toolchain.describe(opened);
		const inputs = Keyed.inputs(opened, module.subpath, resolution, described, module.kind === 'style' ? 'css' : 'js');
		if (!inputs) {
			const message = `Package "${opened.key}" has no integrity: its node has none and its sources were given without the one its fetch verified`;
			return this.#report('error', specifier, [{ code: 'INTEGRITY_MISSING', message }]);
		}
		this.#items.set(id, Keyed.item(module.kind, opened, module.subpath, inputs));
		this.#edges.set(id, edges);

		// The stylesheet the sources of a module import is an output of its own, produced with the module
		const styled = bundled ? typeof bundled.css === 'string' : module.distributed.variants.some(({ outputs }) => outputs.some(({ kind }) => kind === 'css'));
		if (module.kind !== 'module' || !styled) return;
		const style = Keyed.item('style', opened, module.subpath, Object.assign({}, inputs, { output: <const>'css' }));
		this.#items.set(style.id, style);
		edges.push({ target: style.id, lazy: false, declared: false });
		// The static files of a module are the ones its stylesheet addresses as well
		this.#edges.set(style.id, edges.filter(({ target }) => target.startsWith('asset:')));
	}

	/**
	 * The indeterminate imports of a module, each listed as unknown, and what is declared for them.
	 *
	 * @returns The public modules the module or the request declares, which are followed as lazy references
	 */
	#dynamic(id: string, specifier: string, module: IPublicModule, bundled?: IBundled): string[] {
		const declared = [...new Set(module.dynamic.concat(this.#declared[specifier] ?? []))];
		const covered = declared.length > 0;

		(bundled?.indeterminate ?? []).forEach(({ file, line, column, text }) => {
			const location = { file: file ?? 'unknown', line: line ?? 1, column: column ?? 0 };
			const code = covered ? 'DYNAMIC_IMPORT_DECLARED' : 'DYNAMIC_IMPORT_UNKNOWN';
			this.unknown.push({ importer: id, expression: text?.slice(0, 200), location, declared: covered, code });
			if (covered) return;

			const message =
				`Module "${specifier}" loads a module that cannot be known from its code (${location.file}:${location.line}: ${text}). ` +
				`Declare what it may load: "dynamic" in the module manifest, or "declared" in the trace request`;
			this.diagnostics.push({ code, message, severity: 'error' });
		});
		return declared;
	}
}
