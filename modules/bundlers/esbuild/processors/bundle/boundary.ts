import type { Plugin, PluginBuild, OnResolveArgs } from 'esbuild';

/**
 * The public boundary of a packaged module.
 *
 * Relative files and package-private `#imports` are sources of the module and are bundled. Any other
 * bare specifier is a public reference and stays in the output as written; which package and version
 * satisfies it is decided by whoever resolves the artifact, never here. A relative import that lands on
 * the entry point of another public module of the same package is a reference to that module: bundling
 * it again would give the two modules separate copies of one state.
 */
export class Boundary implements Plugin {
	get name() {
		return 'beyond-public-boundary';
	}

	#entries: Map<string, string>;

	#references: Set<string> = new Set();
	get references(): string[] {
		return [...this.#references].sort();
	}

	/**
	 * @param entries The entry point file of every other public module of the package, with its specifier
	 */
	constructor(entries: Map<string, string>) {
		this.#entries = entries;
	}

	#external(specifier: string) {
		this.#references.add(specifier);
		return { path: specifier, external: true };
	}

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /^\.\.?\// }, async (args: OnResolveArgs) => {
			if (args.kind === 'entry-point' || args.pluginData?.boundary) return;

			const { resolveDir, kind, importer } = args;
			const resolved = await build.resolve(args.path, { resolveDir, kind, importer, pluginData: { boundary: true } });
			const specifier = !resolved.errors.length && this.#entries.get(resolved.path);
			return specifier ? this.#external(specifier) : void 0;
		});

		build.onResolve({ filter: /^[^./#]/ }, (args: OnResolveArgs) => {
			if (args.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(args.path)) return;
			return this.#external(args.path);
		});
	};
}
