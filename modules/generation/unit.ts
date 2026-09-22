import type { IDiagnostic } from '@beyond-js/packages/types';
import { type Compiler, type IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Target, Toolchain, Keyed, Specifier, type Pinned, type Opened, type IPublicModule, type IKeyInputs } from '@beyond-js/packages/analysis';
import type { FormatType, IGenerated, IRelations } from './types';
import { Outputs } from './outputs';
import { SystemFormat } from './system';
import { Origins } from './origins';

/**
 * The generation of exactly one compiled public module: its code, its stylesheet and their source maps.
 *
 * The module is compiled the way it was traced. Its public references stay bare in the code, so nothing of
 * another public module is inlined and nothing of this one is split away.
 */
export /*bundle*/ class Unit {
	#pinned: Pinned;
	#opened: Opened;
	#module: IPublicModule;
	#compiler: Compiler;
	#format: FormatType;
	#frozen: Record<string, string>;
	#composed: { name: string; specifier: string } | undefined;

	/**
	 * @param frozen The resolution slice the inventory recorded for the module, which is followed as it is
	 */
	constructor(pinned: Pinned, opened: Opened, module: IPublicModule, compiler: Compiler, format: FormatType, frozen: Record<string, string> = {}) {
		this.#pinned = pinned;
		this.#opened = opened;
		this.#module = module;
		this.#compiler = compiler;
		this.#format = format;
		this.#frozen = frozen;
	}

	async #references(bundled: IBundled, warnings: IDiagnostic[], diagnostics: IDiagnostic[]) {
		const resolution: Record<string, string> = {};
		const references: IRelations['references'] = [];
		for (const { specifier, kind } of bundled.references) {
			const landing = await this.#pinned.land(this.#opened.key, specifier, { key: this.#frozen[new Specifier(specifier).name] });
			warnings.push(...landing.warnings);
			diagnostics.push(...landing.diagnostics);
			if (landing.opened) resolution[new Specifier(specifier).name] = landing.opened.key;
			references.push({ specifier, kind, package: landing.opened?.key, subpath: landing.module && Keyed.subpath(landing.module.subpath), builtin: landing.builtin || void 0 });
		}
		return { resolution, references };
	}

	/**
	 * The compiler as a provenance reports it: what it is, never where it is installed or how it was named,
	 * which are facts of the machine that ran it and not of the output
	 */
	#described(toolchain: Toolchain): Record<string, unknown> {
		const system = this.#format === 'system' ? Toolchain.system : void 0;
		if (this.#composed) {
			// The selected compiler never ran for a composed module: its package declared what compiles it
			return { name: this.#composed.specifier, bundler: this.#composed.name, composition: Toolchain.COMPOSITION, system };
		}

		const { version, assigned, provenance } = this.#compiler.identity;
		return { name: 'esbuild', version, assigned, revision: provenance?.revision, options: toolchain.options(this.#opened), system };
	}

	/**
	 * @param only Restricts the outputs to the stylesheet, which is how the stylesheet item of a module is
	 * generated on its own
	 */
	async run(only?: 'css'): Promise<IGenerated> {
		const started = Date.now();
		const diagnostics: IDiagnostic[] = [];
		const warnings: IDiagnostic[] = [];
		const { conditions } = this.#pinned;
		const { key } = this.#opened;

		const minify = conditions.environment === 'production';
		const target = new Target(this.#pinned, this.#opened, this.#module);
		this.#composed = await target.composed();
		const built = await target.bundle(this.#compiler, minify);
		if (!built.bundled) return { outputs: [], diagnostics: built.diagnostics, warnings };
		const { bundled } = built;

		// Where the package was extracted never reaches an output: sources are renamed before anything else
		const origins = new Origins(this.#opened, this.#opened.root, this.#module.directory);
		let code = bundled.code;
		let map = bundled.map && origins.map(bundled.map);
		if (this.#format === 'system' && typeof code === 'string') {
			const transformed = new SystemFormat().transform(code, map);
			if (transformed.diagnostics.length) return { outputs: [], diagnostics: transformed.diagnostics, warnings };
			({ code, map } = transformed);
		}

		const { resolution, references } = await this.#references(bundled, warnings, diagnostics);
		if (diagnostics.length) return { outputs: [], diagnostics, warnings };

		const toolchain = new Toolchain(this.#compiler, conditions, this.#format);
		const shared = Keyed.inputs(this.#opened, this.#module.subpath, resolution, toolchain.describe(this.#opened, this.#composed), 'js');
		if (!shared) return { outputs: [], diagnostics: [{ code: 'INTEGRITY_MISSING', message: `Package "${key}" has no integrity` }], warnings };
		const outputs = new Outputs(shared);

		const assets = (via: 'js' | 'css') => bundled.resources.filter(resource => resource.via === via).map(({ path }) => ({ package: key, path }));
		const stylesheet = typeof bundled.css === 'string';
		if (typeof code === 'string' && !only) {
			outputs.text('js', code, { references, stylesheet, assets: assets('js') });
			map && outputs.text('map', map, { of: 'js' });
		}
		if (stylesheet) {
			const styles = references.filter(({ kind }) => kind === 'style');
			outputs.text('css', bundled.css, { references: this.#module.kind === 'style' ? references : styles, assets: assets('css') });
			bundled.cssmap && outputs.text('map', origins.map(bundled.cssmap), { of: 'css' });
		}

		const main: IKeyInputs['output'] = this.#module.kind === 'style' || only ? 'css' : 'js';
		const provenance = {
			compiler: this.#described(toolchain),
			files: bundled.inputs.map(input => origins.name(input)).sort(),
			inputs: outputs.inputs(main),
			key: outputs.key(main),
			ms: Date.now() - started
		};
		return { outputs: outputs.list, diagnostics, warnings, provenance };
	}
}
