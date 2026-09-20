import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Metafile, Message } from 'esbuild';
import type { Compiler, ICompilerIdentity } from './compiler';
import { Boundary, type StylesType } from './boundary';
import { Resources, type IResource } from './resources';

/**
 * What to bundle: exactly one public module
 */
export /*bundle*/ interface IBundleRequest {
	/**
	 * The working directory, which the names of the bundled inputs are relative to
	 */
	root: string;

	/**
	 * The entry point file. A stylesheet entry produces a stylesheet and no code.
	 */
	entry: string;

	/**
	 * A generated entry point, used in place of the file when the public API has to be adapted; `entry`
	 * remains the file it is resolved beside
	 */
	facade?: string;

	/**
	 * The entry point file of every other public module of the package, with its specifier
	 */
	entries: Map<string, string>;

	/**
	 * The package root and the public subpath, which decide how static files are addressed
	 */
	package: { root: string; subpath: string };

	platform: string;
	environment?: string;

	/**
	 * Resolution conditions, when the caller decides them; `module` and the environment otherwise
	 */
	conditions?: string[];

	/**
	 * Replaces `process.env.NODE_ENV` also when no environment selects a conditional
	 */
	mode?: string;

	minify?: boolean;
	styles?: StylesType;
}

/**
 * A public reference of the output. `eager` is a static import, `lazy` a dynamic one.
 */
export /*bundle*/ interface IReference {
	specifier: string;
	kind: 'eager' | 'lazy' | 'style';
}

/**
 * An import or a require whose argument is not a literal, so what it loads cannot be known from the code
 */
export /*bundle*/ interface IIndeterminate {
	kind: 'import' | 'require';
	file: string;
	line: number;
	column: number;
	text: string;
}

export /*bundle*/ interface IBundled {
	code?: string;
	map?: string;
	css?: string;
	cssmap?: string;
	exports: string[];
	stars: string[];
	dependencies: string[];
	references: IReference[];
	indeterminate: IIndeterminate[];
	resources: IResource[];
	inputs: string[];
	compiler: ICompilerIdentity;

	/**
	 * The options the compiler ran with, which are part of what makes two outputs compatible
	 */
	configuration: Record<string, unknown>;
}

/**
 * One run of the selected compiler over one public module.
 *
 * It owns the options that make an output a Beyond packaged module: a single native ES module, never split,
 * whose public references stay bare, with the stylesheet the sources import and the static files they use
 * kept as separate outputs and references. The processor of the bundler and whoever generates published
 * outputs run the same object, so a module is compiled one way.
 */
export /*bundle*/ class Bundle {
	#compiler: Compiler;
	#request: IBundleRequest;

	constructor(compiler: Compiler, request: IBundleRequest) {
		this.#compiler = compiler;
		this.#request = request;
	}

	/**
	 * The compiler options a request runs with. They depend on the conditions alone, never on the sources,
	 * so whoever needs to know whether an existing output is compatible computes them without compiling.
	 */
	static configuration(settings: Pick<IBundleRequest, 'platform' | 'environment' | 'conditions' | 'mode' | 'minify'>) {
		const { platform, environment, conditions, mode, minify } = settings;
		const env = mode ?? environment;
		return {
			bundle: true,
			splitting: false,
			format: <const>'esm',
			platform: platform === 'node' ? <const>'node' : <const>'browser',
			conditions: conditions ?? (environment ? ['module', environment] : ['module']),
			define: env ? { 'process.env.NODE_ENV': JSON.stringify(env) } : {},
			target: 'es2022',
			minify: !!minify,
			sourcemap: <const>'external',
			sourcesContent: true
		};
	}

	get #options() {
		return Bundle.configuration(this.#request);
	}

	#references(metafile: Metafile, boundary: Boundary): IReference[] {
		const kinds: Map<string, IReference['kind']> = new Map();
		Object.values(metafile.outputs).forEach(({ imports }) => {
			imports.forEach(({ path, kind, external }) => {
				if (!external || kind === 'url-token') return;
				const lazy = kind === 'dynamic-import' && kinds.get(path) !== 'eager';
				kinds.set(path, lazy ? 'lazy' : 'eager');
			});
		});
		boundary.stylesheets.forEach(specifier => kinds.set(specifier, 'style'));
		return [...kinds].map(([specifier, kind]) => ({ specifier, kind })).sort((a, b) => a.specifier.localeCompare(b.specifier));
	}

	#indeterminate(warnings: Message[]): IIndeterminate[] {
		const ids = { 'unsupported-dynamic-import': <const>'import', 'unsupported-require-call': <const>'require' };
		return warnings
			.filter(({ id }) => id in ids)
			.map(({ id, location }) => ({
				kind: ids[<keyof typeof ids>id],
				file: location?.file,
				line: location?.line,
				column: location?.column,
				text: location?.lineText.trim()
			}));
	}

	/**
	 * @returns The bundle, or the diagnostics of a build that failed. It never throws for a build error.
	 */
	async run(): Promise<{ bundled?: IBundled; diagnostics: IDiagnostic[] }> {
		const { root, entry, facade, entries, styles } = this.#request;
		const boundary = new Boundary(entries, styles);
		const resources = new Resources(this.#request.package.root, this.#request.package.subpath);
		const style = !facade && entry.endsWith('.css');
		const outfile = style ? 'out.css' : 'out.js';
		const source = facade ? { stdin: { contents: facade, resolveDir: root, sourcefile: 'beyond-facade.js', loader: <const>'js' } } : { entryPoints: [entry] };

		try {
			const built = await this.#compiler.api.build(Object.assign({}, this.#options, source, {
				absWorkingDir: root,
				metafile: true,
				write: false,
				outfile,
				logLevel: <const>'silent',
				logOverride: { 'unsupported-dynamic-import': <const>'warning', 'unsupported-require-call': <const>'warning' },
				plugins: [resources, boundary]
			}));

			const text = (suffix: string) => built.outputFiles.find(({ path }) => path.endsWith(suffix))?.text;
			const code = style ? void 0 : text('out.js');
			const stars: string[] = [];
			const pattern = /export\s*\*\s*from\s*["']([^"']+)["']/g;
			for (let match = code && pattern.exec(code); match; match = pattern.exec(code)) stars.push(match[1]);

			const bundled: IBundled = {
				code,
				map: style ? void 0 : text('out.js.map'),
				css: text('out.css'),
				cssmap: text('out.css.map'),
				exports: [...(built.metafile.outputs[outfile].exports ?? [])].sort(),
				stars: [...new Set(stars)].sort(),
				dependencies: boundary.references,
				references: this.#references(built.metafile, boundary),
				indeterminate: this.#indeterminate(built.warnings),
				resources: resources.found,
				inputs: Object.keys(built.metafile.inputs).sort(),
				compiler: this.#compiler.identity,
				configuration: this.#options
			};
			return { bundled, diagnostics: [] };
		} catch (exc) {
			const failures: Message[] = exc.errors ?? [];
			const diagnostics = failures.map(({ text, location }) => {
				const at = location ? `${location.file} (${location.line}:${location.column}): ` : '';
				return { code: 'BUNDLE_ERROR', message: at + text };
			});
			return { diagnostics: diagnostics.length ? diagnostics : [{ code: 'BUNDLE_ERROR', message: exc.message }] };
		}
	}
}
