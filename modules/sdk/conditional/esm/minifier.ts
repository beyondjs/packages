/**
 * The production form of an artifact: the same composition, minified. Nothing else changes between
 * development and production output of a composed module: the internal modules, their identities, the
 * runtime it imports and the widget it registers are the same, so a page that runs the production output
 * behaves as the development one did, without the development connection the preview document adds.
 *
 * The minifier is the `esbuild` installed with Packages, imported on first use through a dynamic import
 * of a variable specifier: a static import of an installed package is not supported by the bootstrap
 * compiler in the node environment, and this module is not compiled at all where no production output
 * is asked for.
 */
export class Minifier {
	static #loading: Promise<Minifier>;
	// The esbuild API, typed loosely: a type reference to the package would make it a dependency of this bundle
	#api: { transformSync(source: string, options: Record<string, unknown>): { code: string } };

	static load(): Promise<Minifier> {
		return (Minifier.#loading ??= new Minifier().#load());
	}

	async #load(): Promise<this> {
		const specifier = 'esbuild';
		const imported = await import(specifier);
		this.#api = imported.default?.transformSync ? imported.default : imported;
		if (typeof this.#api?.transformSync !== 'function') throw new Error('The installed "esbuild" does not expose transformSync');
		return this;
	}

	/**
	 * @returns The minified code, without a source map: production output carries none
	 */
	code(source: string): string {
		return this.#api.transformSync(source, { minify: true, format: 'esm', target: 'es2022', legalComments: 'none' }).code;
	}

	css(source: string): string {
		return this.#api.transformSync(source, { loader: 'css', minify: true, legalComments: 'none' }).code;
	}
}
