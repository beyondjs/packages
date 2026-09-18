import type { Conditional, ProcessorOutputs } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ICompilerIdentity } from './compiler';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { join } from 'path';
import { realpathSync } from 'fs';
import { Compiler } from './compiler';
import { Boundary } from './boundary';

export /*bundle*/ interface IBundle {
	code: string;
	map: string;
	exports: string[];
	stars: string[];
	dependencies: string[];
	inputs: string[];
	compiler: ICompilerIdentity;
}

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
		const compiler = await Compiler.load((<{ compiler?: string }>this.settings.values).compiler);
		if (compiler.error) return done(void 0, [compiler.error]);
		if (!module.spec.entry) {
			return done(void 0, [{ code: 'MODULE_ENTRY_MISSING', message: `Module "${module.spec.subpath}" does not define its entry point` }]);
		}

		const root = realpathSync(join(module.package.path, module.spec.path));
		const boundary = new Boundary(this.#entries());
		const production = environment === 'production';

		try {
			const built = await compiler.api.build({
				absWorkingDir: root,
				entryPoints: [join(root, module.spec.entry)],
				bundle: true,
				format: 'esm',
				platform: platform === 'node' ? 'node' : 'browser',
				conditions: environment ? ['module', environment] : ['module'],
				define: environment ? { 'process.env.NODE_ENV': JSON.stringify(environment) } : {},
				target: 'es2022',
				minify: production,
				sourcemap: 'external',
				sourcesContent: true,
				metafile: true,
				write: false,
				outfile: 'out.js',
				logLevel: 'silent',
				plugins: [boundary]
			});

			const text = (suffix: string) => built.outputFiles.find(({ path }) => path.endsWith(suffix))?.text;
			const code = text('out.js');
			const stars: string[] = [];
			const pattern = /export\s*\*\s*from\s*["']([^"']+)["']/g;
			for (let match = pattern.exec(code); match; match = pattern.exec(code)) stars.push(match[1]);
			done({
				code,
				map: text('out.js.map'),
				exports: [...built.metafile.outputs['out.js'].exports].sort(),
				stars: [...new Set(stars)].sort(),
				dependencies: boundary.references,
				inputs: Object.keys(built.metafile.inputs).sort(),
				compiler: compiler.identity
			}, []);
		} catch (exc) {
			const failures: { text: string; location?: { file: string; line: number; column: number } }[] = exc.errors ?? [];
			const diagnostics = failures.map(({ text, location }) => {
				const at = location ? `${location.file} (${location.line}:${location.column}): ` : '';
				return { code: 'BUNDLE_ERROR', message: at + text };
			});
			done(void 0, diagnostics.length ? diagnostics : [{ code: 'BUNDLE_ERROR', message: exc.message }]);
		}
	}
}
