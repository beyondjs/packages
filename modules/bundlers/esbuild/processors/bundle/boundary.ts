import type { Plugin, PluginBuild, OnResolveArgs } from 'esbuild';

/**
 * What tells the boundary which public specifiers are stylesheets. A stylesheet is not importable code:
 * the reference is recorded and removed from the output, and whoever delivers the module links it.
 */
export /*bundle*/ type StylesType = (specifier: string) => boolean | Promise<boolean>;

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
 */
export /*bundle*/ class Boundary implements Plugin {
	get name() {
		return 'beyond-public-boundary';
	}

	#entries: Map<string, string>;
	#styles?: StylesType;

	#references: Set<string> = new Set();
	get references(): string[] {
		return [...this.#references].sort();
	}

	#stylesheets: Set<string> = new Set();

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
	constructor(entries: Map<string, string>, styles?: StylesType) {
		this.#entries = entries;
		this.#styles = styles;
	}

	async #external(specifier: string, args: OnResolveArgs) {
		if (await this.#styles?.(specifier)) {
			this.#stylesheets.add(specifier);
			return { path: specifier, namespace: args.kind === 'import-rule' ? 'beyond-style-rule' : 'beyond-style' };
		}
		if (args.kind === 'require-call') return { path: specifier, namespace: 'beyond-require' };

		this.#references.add(specifier);
		return { path: specifier, external: true };
	}

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /^\.\.?\// }, async (args: OnResolveArgs) => {
			if (args.kind === 'entry-point' || args.pluginData?.boundary) return;

			const { resolveDir, kind, importer } = args;
			const resolved = await build.resolve(args.path, { resolveDir, kind, importer, pluginData: { boundary: true } });
			const specifier = !resolved.errors.length && this.#entries.get(resolved.path);
			return specifier ? this.#external(specifier, args) : void 0;
		});

		build.onResolve({ filter: /^[^./#]/ }, (args: OnResolveArgs) => {
			if (args.kind === 'entry-point' || args.kind === 'url-token' || /^[A-Za-z]:[\\/]/.test(args.path)) return;
			return this.#external(args.path, args);
		});

		build.onLoad({ filter: /.*/, namespace: 'beyond-style' }, () => ({ contents: '', loader: 'js' }));
		build.onLoad({ filter: /.*/, namespace: 'beyond-style-rule' }, () => ({ contents: '', loader: 'css' }));
		build.onLoad({ filter: /.*/, namespace: 'beyond-require' }, ({ path }) => {
			const contents =
				`import * as ns from ${JSON.stringify(path)};\n` +
				`const value = ns.default;\n` +
				`const holder = value !== null && (typeof value === 'object' || typeof value === 'function');\n` +
				`module.exports = holder && Object.keys(ns).every(name => name === 'default' || value[name] === ns[name]) ? value : ns;\n`;
			return { contents, loader: 'js' };
		});
	};
}
