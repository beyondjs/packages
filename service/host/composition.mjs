import { Installation } from '../installation.mjs';

/**
 * What one generation of the hosted workspace is made of: the members its declaration names, the installed
 * graph when the workspace has one, the packages the toolchain supplies that may still be added, and what a Node
 * consumer still resolves from the toolchain installation.
 *
 * - The members are given to Packages as they were declared, whatever the kind of the declaration (npm
 *   `workspaces`, `beyond.workspaces`, `beyond.json` or a standalone package), each by its id and directory.
 * - A projection that is ready, stale or incomplete is the installed graph: the workspace resolves every import
 *   through it. Stale and incomplete ones are still served, with their diagnostics, so that the state of the
 *   service says what to do instead of silently falling back to something else.
 * - With an installed graph no supplied package is added at all (D8): a copy of the toolchain must never conceal
 *   that the graph of the workspace was not consumed. Without one, a supplied package whose name a member
 *   provides is not added either: the workspace wins, and both copies would make the name ambiguous.
 * - With an installed graph the runtime of the session is the toolchain's own runtime alone, when the graph does
 *   not provide it (D10, A13): the libraries only the supplied packages needed went with them.
 *
 * ```js
 * const composition = new Composition(declaration, projection, { supplied, runtime });
 * new Workspace(root, composition.options);
 * ```
 */
export class Composition {
	/**
	 * The projection states whose execution is served
	 */
	static INSTALLED = ['ready', 'stale', 'incomplete'];

	/**
	 * What the workspace declares now, as `Execution.read` compares a projection with it: the digests of its
	 * inputs and the directory of each member, so a member whose directory changed under the same manifest (a
	 * link pointed elsewhere) makes the projection stale instead of leaving it ready and its imports refused
	 *
	 * @param {{inputs: object, members: {id: string, path: string}[]}} declaration
	 * @returns {{inputs: object, locations: Record<string, string>}}
	 */
	static current(declaration) {
		return { inputs: declaration.inputs, locations: Object.fromEntries(declaration.members.map(({ id, path }) => [id, path])) };
	}

	#declaration;
	#projection;
	#supplied;
	#runtime;

	/**
	 * @param {{members: {id: string, path: string, name: string}[]}} declaration The declaration of the
	 * workspace, as `Declaration.read` gives it
	 * @param {{state: string, diagnostics: object[], execution?: object}} projection The execution projection
	 * as `Execution.read` gives it
	 * @param {{supplied?: {name: string, path: string}[], runtime?: {packages: string[], base: string}}} [toolchain]
	 * What the toolchain offers every workspace: the packages it supplies and has installed, and the runtime a Node
	 * consumer resolves from its installation (its own runtime and the libraries the supplied packages need)
	 */
	constructor(declaration, projection, { supplied = [], runtime } = {}) {
		this.#declaration = declaration;
		this.#projection = projection;
		this.#supplied = supplied;
		this.#runtime = runtime;
	}

	/**
	 * Whether the workspace is served through its installed graph
	 */
	get installed() {
		return Composition.INSTALLED.includes(this.#projection.state) && !!this.#projection.execution;
	}

	/**
	 * The execution projection the workspace resolves through, when it is installed
	 */
	get execution() {
		return this.installed ? this.#projection.execution : void 0;
	}

	/**
	 * The members as the Packages workspace takes them: their id and their absolute directory
	 *
	 * @returns {{id: string, path: string}[]}
	 */
	get members() {
		return this.#declaration.members.map(({ id, path }) => ({ id, path }));
	}

	/**
	 * The supplied packages that are added to the workspace
	 *
	 * @returns {{name: string, path: string}[]}
	 */
	get supplied() {
		if (this.installed) return [];
		const provided = new Set(this.#declaration.members.map(({ name }) => name));
		return this.#supplied.filter(({ name }) => !provided.has(name));
	}

	/**
	 * The options of the Packages workspace of this generation. Its packages watch their sources, except the
	 * supplied ones, which change only when the toolchain is replaced.
	 */
	get options() {
		const { execution } = this;
		return {
			watcher: true,
			members: this.members,
			supplied: this.supplied.map(({ path }) => path),
			...(execution ? { execution } : {})
		};
	}

	/**
	 * Whether the installed graph provides a package of this name: a member or an installed node. A Node
	 * consumer must then not resolve it from the toolchain (D10): an explicit failure is better than a copy that
	 * is not the one the graph selected.
	 *
	 * @param {string} name
	 */
	provides(name) {
		return !!this.execution?.find(name)?.length;
	}

	/**
	 * The runtime a Node consumer of this generation resolves from the toolchain installation, as the session
	 * describes it. Without an installed graph it is what the toolchain offers. With one, the supplied packages are
	 * not added, so neither are the libraries they need: only the toolchain's own runtime is left, and only when
	 * the graph does not provide it.
	 *
	 * @returns {{packages: string[], base: string} | undefined}
	 */
	get runtime() {
		const runtime = this.#runtime;
		if (!runtime || !this.installed) return runtime;

		const packages = runtime.packages.filter(name => Installation.RUNTIME.includes(name) && !this.provides(name));
		return { ...runtime, packages };
	}
}
