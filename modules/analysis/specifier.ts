/**
 * A bare public specifier, split into the package it names and the subpath of the public module:
 * `@scope/name/core/router` is the module `./core/router` of `@scope/name`. An exact version may follow the
 * package name (`@scope/name@1.0.0/core/router`), which is how an entry selects one node of a graph.
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
	 * `.` for the root module of the package, `./name` otherwise
	 */
	get subpath() {
		return this.#subpath;
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
	}

	/**
	 * The specifier of a public module of a package
	 */
	static of(name: string, subpath: string): string {
		return subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`;
	}
}
