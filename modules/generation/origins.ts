import { realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * The names the sources of an output have in its source map and its provenance.
 *
 * A compiler names its inputs relatively to where it ran, and an adapted entry point or a required public
 * module has no file at all. Published outputs must not depend on where a package happened to be extracted,
 * so every source is renamed under a stable virtual root: `beyond://<package>@<version>/<path in the
 * package>`, and what was generated for the unit under `beyond://<package>@<version>/~generated/…`. The
 * same package extracted anywhere yields the same names, the same bytes and the same digests.
 */
export /*bundle*/ class Origins {
	#prefix: string;
	#root: string;
	#directory: string;

	/**
	 * @param root The extracted package root
	 * @param directory The directory the compiler named its inputs from
	 */
	constructor(pkg: { name: string; version: string }, root: string, directory: string) {
		this.#prefix = `beyond://${pkg.name}@${pkg.version}/`;
		// Both are compared in their real form: a temporary directory is often reached through a link
		this.#root = realpathSync(root);
		this.#directory = realpathSync(directory);
	}

	/**
	 * The stable name of one input, as the compiler reported it
	 */
	name(input: string): string {
		if (input.startsWith(this.#prefix)) return input;

		// Generated inputs: the adapted entry point, and the modules a namespace of the boundary stands for
		if (input === 'beyond-facade.js' || input === '<stdin>') return `${this.#prefix}~generated/facade.js`;
		const generated = /^(beyond-[a-z-]+):(.*)$/.exec(input);
		if (generated) {
			const subject = generated[2].replace(/^(\.\.?\/)+/, '');
			return `${this.#prefix}~generated/${generated[1].replace(/^beyond-/, '')}/${subject}`;
		}

		const path = relative(this.#root, resolve(this.#directory, input));
		const inside = path && !path.startsWith('..') && !isAbsolute(path);
		// A file outside the package is named without its location, which is never published
		return this.#prefix + (inside ? path.split(sep).join('/') : `~outside/${input.split(/[\\/]/).pop()}`);
	}

	/**
	 * A source map with its sources renamed. Its mappings and the content of its sources are kept.
	 */
	map(text: string): string {
		const map = JSON.parse(text);
		map.sources = (<string[]>map.sources ?? []).map(source => this.name(source));
		delete map.sourceRoot;
		return JSON.stringify(map);
	}
}
