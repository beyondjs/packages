/**
 * A bare public specifier, split into the package it names and the subpath of the public module:
 * `@scope/name/core/router` is the module `./core/router` of `@scope/name`. An exact version may follow the
 * package name (`@scope/name@1.0.0/core/router`), which is how an entry selects one node of a graph.
 *
 * A specifier imports the JavaScript output of a public module unless an explicit extension selects another
 * output: `.css` selects the stylesheet, `.js` and `.mjs` state the JavaScript output. The extension is only
 * a selection when it ends the specifier; which public module it selects is decided against the package
 * ([Output](./pinned/output.ts)), because a package may also publish a literal subpath with that extension.
 */
export /*bundle*/ class Specifier {
	#name: string;
	get name() {
		return this.#name;
	}

	#version?: string;
	get version() {
		return this.#version;
	}

	#subpath: string;

	/**
	 * `.` for the root module of the package, `./name` otherwise, as it is written
	 */
	get subpath() {
		return this.#subpath;
	}

	#extension?: 'css' | 'js';

	/**
	 * The output an explicit extension selects: `css` for `.css`, `js` for `.js` and `.mjs`, none otherwise
	 */
	get extension() {
		return this.#extension;
	}

	#stripped?: string;

	/**
	 * The subpath without the extension that selects an output, when the subpath carries one: the public
	 * module whose output is selected. A root specifier whose package name ends with the extension
	 * (`normalize.css`) has none.
	 */
	get stripped() {
		return this.#stripped;
	}

	get valid() {
		return !!this.#name;
	}

	constructor(value: string) {
		const match = /^((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(?:\/(.+))?$/.exec(typeof value === 'string' ? value : '');
		if (!match) return;
		this.#name = match[1];
		this.#version = match[2];
		this.#subpath = match[3] ? `./${match[3]}` : '.';

		const extension = /\.(css|js|mjs)$/.exec(match[3] ?? match[1]);
		if (!extension) return;
		this.#extension = extension[1] === 'css' ? 'css' : 'js';

		const stripped = match[3]?.slice(0, -extension[0].length);
		this.#stripped = stripped && !stripped.endsWith('/') ? `./${stripped}` : void 0;
	}

	/**
	 * The specifier of a public module of a package
	 */
	static of(name: string, subpath: string): string {
		return subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`;
	}
}
