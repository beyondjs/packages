import { isAbsolute, join, resolve } from 'path';

/**
 * The source map of a development bundle with every source named by its absolute path.
 *
 * The compiler names its inputs relatively to the directory it ran in. A development service delivers the map
 * inline, and a debugger or an editor finds a source by that name, so the contract of the compiled-module API
 * asks for absolute paths that keep their directories, no `sourceRoot`, and the content of every source or of
 * none. An input that is not a file — the adapted entry point, a module a namespace of the boundary stands
 * for — is named under `~generated/` of the package root, with its content in the map. Published outputs are
 * named by `Origins` of the generation instead, never by where a package is.
 */
export /*bundle*/ class Located {
	#directory: string;
	#root: string;

	/**
	 * @param directory The directory the compiler named its inputs from
	 * @param root The package root
	 */
	constructor(directory: string, root: string) {
		this.#directory = directory;
		this.#root = root;
	}

	/**
	 * The absolute name of one input, as the compiler reported it
	 */
	name(input: string): string {
		if (input === 'beyond-facade.js' || input === '<stdin>') return join(this.#root, '~generated', 'facade.js');
		const generated = /^(beyond-[a-z-]+):(.*)$/.exec(input);
		if (generated) {
			const subject = generated[2].replace(/^(\.\.?\/)+/, '');
			return join(this.#root, '~generated', generated[1].replace(/^beyond-/, ''), subject);
		}
		return isAbsolute(input) ? input : resolve(this.#directory, input);
	}

	/**
	 * The map with its sources renamed, without `sourceRoot`, and with the content of every source or of none.
	 * Its mappings are kept. A text that is not a map is returned as it is.
	 */
	map(text: string | undefined): string | undefined {
		if (!text) return text;

		let map: { sources?: string[]; sourceRoot?: string; sourcesContent?: (string | null)[] };
		try {
			map = JSON.parse(text);
		} catch {
			return text;
		}
		if (!(map.sources instanceof Array)) return text;

		const base = map.sourceRoot ? resolve(this.#directory, map.sourceRoot) : this.#directory;
		const located = new Located(base, this.#root);
		map.sources = map.sources.map(source => located.name(source));
		delete map.sourceRoot;
		const content = map.sourcesContent;
		const complete = content instanceof Array && content.length === map.sources.length && content.every(one => typeof one === 'string');
		!complete && delete map.sourcesContent;
		return JSON.stringify(map);
	}
}
