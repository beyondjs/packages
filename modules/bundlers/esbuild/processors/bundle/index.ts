import type { Conditional, ProcessorOutputs } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { join } from 'path';
import { realpathSync } from 'fs';
import { Compiler } from './compiler';
import { Bundle, type IBundled } from './bundle';
import { Located } from './located';

/**
 * What the processor leaves for its conditional: the bundle of the whole module, with its stylesheet and
 * the static files it uses when the sources have them
 */
export /*bundle*/ type IBundle = IBundled;

/**
 * Bundles the sources of a public module into one native ES module with the selected esbuild compiler.
 *
 * The files of the module directory are its watched inputs, so editing any of them builds the module
 * again; what is actually compiled is what the compiler reaches from the entry point. The result is kept
 * as `bundle` for the conditional, because a bundle is one output of the whole module and not one per file.
 */
export /*bundle*/ class Processor extends ConditionalProcessor {
	#bundle: IBundle;
	get bundle(): IBundle {
		return this.#bundle;
	}

	#diagnostics: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#diagnostics.concat(super.errors);
	}

	constructor(conditional: Conditional, name: string) {
		const extname = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.css'];
		super(conditional, name, { sources: { inputs: { extname } } });
	}

	_settings(values: Record<string, unknown>) {
		return { values: { compiler: values.compiler } };
	}

	/**
	 * The entry point of every other public module of the package, which this module references instead of
	 * bundling. The compiler reports real paths, so they are compared in that form.
	 */
	#entries(): Map<string, string> {
		const { module } = this.conditional;
		const pkg = module.package;
		const entries: Map<string, string> = new Map();

		pkg.modules.forEach((other, subpath) => {
			if (other === module || !other.spec.entry) return;
			const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
			try {
				entries.set(realpathSync(join(pkg.path, other.spec.path, other.spec.entry)), specifier);
			} catch {
				// A module whose entry point does not exist reports it itself
			}
		});
		return entries;
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		void outputs;
		const done = (bundle: IBundle, diagnostics: IDiagnostic[]) => {
			if (request !== this._request) return;
			this.#bundle = bundle;
			this.#diagnostics = diagnostics;
		};

		const { module, platform, environment } = this.conditional;
		const compiler = await Compiler.load((<{ compiler?: string }>this.settings.values).compiler, module.package.path);
		if (compiler.error) return done(void 0, [compiler.error]);
		if (!module.spec.entry) {
			return done(void 0, [{ code: 'MODULE_ENTRY_MISSING', message: `Module "${module.spec.subpath}" does not define its entry point` }]);
		}

		const root = realpathSync(join(module.package.path, module.spec.path));
		const bundle = new Bundle(compiler, {
			root,
			entry: join(root, module.spec.entry),
			entries: this.#entries(),
			package: { root: module.package.path, subpath: module.spec.subpath },
			platform,
			environment,
			minify: environment === 'production'
		});

		const { bundled, diagnostics } = await bundle.run();
		// The development service delivers these maps inline: every source is named by its absolute path
		const located = new Located(root, realpathSync(module.package.path));
		done(bundled && Object.assign(bundled, { map: located.map(bundled.map), cssmap: located.map(bundled.cssmap) }), diagnostics);
	}
}
