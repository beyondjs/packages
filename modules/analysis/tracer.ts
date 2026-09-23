import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Compiler, IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import type { IItem, IUnknown, IInventoryDiagnostic } from './types';
import type { Pinned } from './pinned';
import type { Opened, IPublicModule } from './pinned/opened';
import type { Toolchain } from './toolchain';
import { Assets } from './assets';
import { Keyed } from './keyed';
import { Specifier } from './specifier';
import { Compiled } from './compiled';
import { Reach, type IEdge } from './reach';

interface IPending {
	opened: Opened;
	module: IPublicModule;

	/**
	 * The package that reached the module, which is the context its peers were resolved in
	 */
	context?: string;

	/**
	 * `css` when only the stylesheet of the module is imported (`pkg/sub.css`): its code is not loaded
	 */
	output: 'js' | 'css';
}

/**
 * Walks the public modules an application reaches from its entries.
 *
 * Each module is visited once for its code and once for its stylesheet. A compiled form is bundled in memory
 * only to read what it references, and its code is dropped; a distributed form is read from its manifest.
 * References are followed along the pinned graph, so the walk never leaves the packages that were fetched,
 * and a module nothing references is never opened.
 *
 * A reference to a stylesheet (`pkg/sub.css`) reaches the `style` item of that module and nothing of its
 * code. A widget of a package that publishes a shared `./global` stylesheet reaches that sheet as well: the
 * widget adopts it in its root, so preparing the widget alone prepares the sheet.
 */
export /*bundle*/ class Tracer {
	#pinned: Pinned;
	#compiled: Compiled;
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
		this.#compiled = new Compiled(pinned, compiler);
		this.#toolchain = toolchain;
		this.#declared = declared;
	}

	#report(severity: 'error' | 'warning', specifier: string, list: IDiagnostic[]): void {
		list.forEach(({ code, message }) => this.diagnostics.push({ code, message: `Module "${specifier}": ${message}`, severity }));
	}

	/**
	 * Schedules a public module, and answers the id its item has or will have
	 *
	 * @param output `css` schedules the stylesheet of the module alone
	 */
	enqueue(opened: Opened, module: IPublicModule, context?: string, output: 'js' | 'css' = 'js'): string {
		const id = Keyed.id(output === 'css' ? 'style' : module.kind, opened.key, module.subpath);
		if (!this.#items.has(id)) {
			this.#items.set(id, void 0);
			this.#pending.push({ opened, module, context, output });
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
		this.cost.compiled = this.#compiled.count;
		this.#items.forEach((item, id) => !item && this.#items.delete(id));
		this.#assets.items.forEach(item => this.#items.set(item.id, item));
		this.#assets.diagnostics.forEach(({ code, message }) => this.diagnostics.push({ code, message, severity: 'error' }));

		new Reach(this.#items, this.#edges).relate(entries);
		return [...this.#items.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
	}

	async #visit({ opened, module, context, output }: IPending): Promise<void> {
		const specifier = Specifier.of(opened.name, module.subpath);

		// The stylesheet of a module that is not a style module, selected without its code
		const alone = output === 'css' && module.kind === 'module';

		let bundled: IBundled;
		let composed: { name: string; specifier: string } | undefined;
		if (module.distributed) this.cost.read++;
		else {
			const compiled = await this.#compiled.get(opened, module);
			if (!compiled.bundled) return this.#report('error', specifier, compiled.diagnostics);
			({ bundled, composed } = compiled);
		}

		const { edges, resolution } = await this.#references(opened, module, bundled, context, alone);

		const paths: [string, boolean][] = module.assets.concat(opened.assets).map(path => [path, true]);
		bundled?.resources.forEach(({ path }) => paths.push([path, false]));
		for (const [path, listed] of paths) {
			const asset = await this.#assets.add(opened, path, listed);
			asset && edges.push({ target: asset, lazy: false, declared: false });
		}

		const described = this.#toolchain.describe(opened, composed);
		const inputs = Keyed.inputs(opened, module.subpath, resolution, described, module.kind === 'style' ? 'css' : 'js');
		if (!inputs) {
			const message = `Package "${opened.key}" has no integrity: its node has none and its sources were given without the one its fetch verified`;
			return this.#report('error', specifier, [{ code: 'INTEGRITY_MISSING', message }]);
		}

		// The stylesheet the sources of a module import is an output of its own, produced with the module
		const styled = bundled ? typeof bundled.css === 'string' : module.distributed.variants.some(({ outputs }) => outputs.some(({ kind }) => kind === 'css'));
		if (alone && !styled) {
			const message = `"${specifier}.css" selects the stylesheet of "${specifier}", which produces none`;
			return this.#report('error', specifier, [{ code: 'OUTPUT_NOT_FOUND', message }]);
		}

		if (!alone) {
			const id = Keyed.id(module.kind, opened.key, module.subpath);
			this.#items.set(id, Keyed.item(module.kind, opened, module.subpath, inputs));
			this.#edges.set(id, edges);
		}

		if (module.kind === 'module' && styled) {
			const style = Keyed.item('style', opened, module.subpath, Object.assign({}, inputs, { output: <const>'css' }));
			this.#items.set(style.id, style);
			!alone && edges.push({ target: style.id, lazy: false, declared: false });
			// The static files of a module are the ones its stylesheet addresses as well
			this.#edges.set(style.id, edges.filter(({ target }) => target.startsWith('asset:')));
		}

		!alone && (await this.#global(opened, bundled, edges));
	}

	/**
	 * Follows the public references of a module and records the slice of the graph its outputs depend on
	 *
	 * @param alone Whether only the stylesheet of the module is visited: its references decide its key, and
	 * none of them is loaded, so none is scheduled or reported
	 */
	async #references(opened: Opened, module: IPublicModule, bundled: IBundled | undefined, context: string | undefined, alone: boolean) {
		const id = Keyed.id(module.kind, opened.key, module.subpath);
		const specifier = Specifier.of(opened.name, module.subpath);
		const edges: IEdge[] = [];
		const resolution: Record<string, string> = {};

		const coded = module.distributed ? module.distributed.references : bundled.references;
		const declared = alone ? [] : this.#dynamic(id, specifier, module, bundled).filter(name => !coded.some(reference => reference.specifier === name));
		const references = coded.map(reference => Object.assign({ declared: false }, reference)).concat(declared.map(name => ({ specifier: name, kind: <const>'lazy', declared: true })));

		for (const reference of references) {
			const css = reference.kind === 'style';
			const landing = await this.#pinned.land(opened.key, reference.specifier, { context, css });
			// Only what the code itself references decides its output; a declaration adds items, not inputs
			if (landing.opened && !reference.declared) resolution[new Specifier(reference.specifier).name] = landing.opened.key;
			if (alone) continue;

			this.#report('warning', specifier, landing.warnings);
			this.#report('error', specifier, landing.diagnostics);
			if (landing.builtin && this.#pinned.conditions.platform !== 'node') {
				this.#report('warning', specifier, [{ code: 'NODE_BUILTIN_REFERENCED', message: `"${reference.specifier}" is a Node builtin, which a browser cannot import` }]);
			}
			if (!landing.module) continue;

			const target = this.enqueue(landing.opened, landing.module, opened.key, landing.output);
			edges.push({ target, lazy: reference.kind === 'lazy', declared: reference.declared });
		}
		return { edges, resolution };
	}

	/**
	 * The shared stylesheet a widget adopts in its root: the `./global` style module of its package, which the
	 * composition declares in the registration of the widget. A package that publishes none adds nothing.
	 */
	async #global(opened: Opened, bundled: IBundled | undefined, edges: IEdge[]): Promise<void> {
		if (!bundled?.configuration?.global) return;
		const found = await opened.module('./global', this.#pinned.conditions);
		if (!found.module) return this.#report('error', Specifier.of(opened.name, './global'), found.diagnostics);
		edges.push({ target: this.enqueue(opened, found.module, opened.key, 'css'), lazy: false, declared: false });
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
