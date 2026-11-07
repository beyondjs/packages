import type { Plugin, PluginBuild, OnResolveArgs } from 'esbuild';
import { builtinModules } from 'module';

/**
 * What tells the boundary which other public specifiers are stylesheets, beside the ones a `.css` extension
 * selects. A stylesheet is not importable code: the reference is recorded and removed from the output, and
 * whoever delivers the module links it.
 */
export /*bundle*/ type StylesType = (specifier: string) => boolean | Promise<boolean>;

/**
 * What the boundary knows of where the module runs and of what its package may lack
 */
export /*bundle*/ interface IBoundarySettings {
	/**
	 * For Node, a builtin is written with its `node:` scheme (`util` is `node:util`), the one spelling every
	 * runtime with Node's builtins reads, Deno releases before 2.9 included
	 */
	node?: boolean;

	/**
	 * The packages its manifest declares optional and the pinned graph does not hold: a `require` of one throws
	 * `MODULE_NOT_FOUND` when it runs, as Node's does when an optional dependency is not installed
	 */
	absent?: string[];
}

/**
 * The public boundary of a packaged module.
 *
 * Relative files and package-private `#imports` are sources of the module and are bundled. Any other
 * bare specifier is a public reference and stays in the output as written; which package and version
 * satisfies it is decided by whoever resolves the artifact, never here. A relative import that lands on
 * the entry point of another public module of the same package is a reference to that module: bundling
 * it again would give the two modules separate copies of one state.
 *
 * A CommonJS source that requires a public module keeps the same boundary: the `require` call reads a
 * native import of the bare specifier, so a renderer and the library it requires share one instance. What
 * `require` returns is the CommonJS value of the required module when it is published as one (a default
 * export that carries every named export, which is the shape of a Node builtin and of an adapted CommonJS
 * package), and its namespace otherwise.
 *
 * For Node, a builtin keeps its public identity under the spelling every runtime reads: `util`, `fs/promises`
 * and their `require` are written `node:util` and `node:fs/promises`. A name that only resolves to a package
 * (`punycode/`, with its slash) is not a builtin and stays as written. A `require` of a builtin returns its
 * default export, which is its CommonJS value in Node and in Deno alike, even where a runtime's namespace has
 * names its default does not carry (Deno before 2.9 for `node:events`).
 *
 * A `require` of a package the manifest declares optional (`optionalDependencies`, or an optional peer in
 * `peerDependenciesMeta`) that the pinned graph does not hold reads a module that throws `MODULE_NOT_FOUND` when the
 * `require` runs: a CommonJS source guards such a `require` (`try { require('supports-color') } catch {}`), and a
 * native import of it would fail the whole module before the guard runs. An import statement of it stays a
 * reference, which the resolution of the output reports.
 *
 * A bare specifier that ends with `.css` selects the stylesheet of a public module (`pkg/sub.css`), never
 * code: it is recorded as a stylesheet and removed from the output. A relative import of the stylesheet
 * another public module of the package is published from is the same selection. A stylesheet binds
 * nothing: an import that asks it for a value, or for a CSS module script (`with { type: 'css' }`), is
 * refused, because nothing would deliver that value.
 */
export /*bundle*/ class Boundary implements Plugin {
	get name() {
		return 'beyond-public-boundary';
	}

	#entries: Map<string, string>;
	#styles?: StylesType;
	#node: boolean;
	#absent: Set<string>;

	#references: Set<string> = new Set();
	get references(): string[] {
		return [...this.#references].sort();
	}

	#stylesheets: Set<string> = new Set();
	#refused: Set<string> = new Set();

	/**
	 * Whether an error of the build is an import that asked a stylesheet for a value, which the boundary refused
	 */
	refused(text: string): boolean {
		return this.#refused.has(text);
	}

	/**
	 * The stylesheet public modules the sources reference, which are not in the output
	 */
	get stylesheets(): string[] {
		return [...this.#stylesheets].sort();
	}

	/**
	 * @param entries The entry point file of every other public module of the package, with its specifier
	 * @param styles Which public specifiers are stylesheets; none when it is omitted
	 */
	constructor(entries: Map<string, string>, styles?: StylesType, settings: IBoundarySettings = {}) {
		this.#entries = entries;
		this.#styles = styles;
		this.#node = !!settings.node;
		this.#absent = new Set(settings.absent ?? []);
	}

	/**
	 * The spelling of a builtin for Node: its `node:` scheme, which a bare name that is a builtin gets
	 */
	static builtin(specifier: string): string {
		return !specifier.startsWith('node:') && builtinModules.includes(specifier) ? `node:${specifier}` : specifier;
	}

	// The package a bare specifier names: `@scope/name` or `name`
	static #package(specifier: string): string {
		const parts = specifier.split('/');
		return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
	}

	/**
	 * The error of an import that asks a stylesheet for a value
	 */
	static binding(specifier: string): string {
		return `"${specifier}" is a stylesheet: import it for its effect alone (import '${specifier}'), which links it; a stylesheet binds no value and is not a CSS module script`;
	}

	async #external(specifier: string, args: OnResolveArgs) {
		const style = /\.css$/.test(specifier) || (await this.#styles?.(specifier));
		if (style && (<{ with?: Record<string, string> }>args).with?.type === 'css') {
			const text = Boundary.binding(specifier);
			this.#refused.add(text);
			return { errors: [{ text }] };
		}
		if (style) {
			this.#stylesheets.add(specifier);
			return { path: specifier, namespace: args.kind === 'import-rule' ? 'beyond-style-rule' : 'beyond-style' };
		}
		const written = this.#node ? Boundary.builtin(specifier) : specifier;
		if (args.kind === 'require-call') {
			if (written === specifier && this.#absent.has(Boundary.#package(specifier))) return { path: specifier, namespace: 'beyond-absent' };
			return { path: specifier, namespace: 'beyond-require', pluginData: { specifier: written } };
		}

		this.#references.add(written);
		return { path: written, external: true };
	}

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /^\.\.?\// }, async (args: OnResolveArgs) => {
			if (args.kind === 'entry-point' || args.pluginData?.boundary) return;

			const { resolveDir, kind, importer } = args;
			const resolved = await build.resolve(args.path, { resolveDir, kind, importer, pluginData: { boundary: true } });
			const specifier = !resolved.errors.length && this.#entries.get(resolved.path);
			if (!specifier) return;

			// The file another public module is published from, when it is a stylesheet, is its stylesheet
			const css = resolved.path.endsWith('.css') && !specifier.endsWith('.css');
			return this.#external(css ? `${specifier}.css` : specifier, args);
		});

		build.onResolve({ filter: /^[^./#]/ }, (args: OnResolveArgs) => {
			if (args.kind === 'entry-point' || args.kind === 'url-token' || /^[A-Za-z]:[\\/]/.test(args.path)) return;
			return this.#external(args.path, args);
		});

		// An ES module without exports: a default or named import of it fails the build instead of reading undefined
		build.onLoad({ filter: /.*/, namespace: 'beyond-style' }, () => ({ contents: 'export {};', loader: 'js' }));
		build.onLoad({ filter: /.*/, namespace: 'beyond-style-rule' }, () => ({ contents: '', loader: 'css' }));
		build.onLoad({ filter: /.*/, namespace: 'beyond-absent' }, ({ path }) => {
			const message = JSON.stringify(`Cannot find module '${path}': it is an optional dependency the release does not hold`);
			return { contents: `const error = new Error(${message});\nerror.code = 'MODULE_NOT_FOUND';\nthrow error;\n`, loader: 'js' };
		});
		build.onLoad({ filter: /.*/, namespace: 'beyond-require' }, ({ path, pluginData }) => {
			const specifier: string = pluginData?.specifier ?? path;
			// What `require` returns of a builtin is its CommonJS value, which its default export is in every runtime
			if (specifier.startsWith('node:')) {
				return { contents: `import * as ns from ${JSON.stringify(specifier)};\nmodule.exports = ns.default !== undefined ? ns.default : ns;\n`, loader: 'js' };
			}
			const contents =
				`import * as ns from ${JSON.stringify(specifier)};\n` +
				`const value = ns.default;\n` +
				`const holder = value !== null && (typeof value === 'object' || typeof value === 'function');\n` +
				`module.exports = holder && Object.keys(ns).every(name => name === 'default' || value[name] === ns[name]) ? value : ns;\n`;
			return { contents, loader: 'js' };
		});
	};
}
