/**
 * The import map of a preview while its graph is walked.
 *
 * The first address a specifier is given is its import: the version the entry reaches first. An importer that
 * resolves the specifier to another address, such as a package that installs its own version of a library, gets
 * it in the scope of its package prefix, as a release does; one that resolves the same address needs no scope.
 * Scope keys are addresses like the imports: relative to the document for this environment, on the CDN origin
 * otherwise.
 *
 * A map gives an importer one address per specifier. When the graph of an installed workspace binds the importer
 * (one package instance, one prefix) to two addresses of a specifier in one document, as two applications that
 * provide two releases of a peer to one library do, the second binding is not written: it is reported, because
 * any address the map kept would be a release the other path does not depend on. An import of an installed graph
 * that has no address is not left out either, since a scope without the specifier falls back to the import another
 * importer was given: its scope maps it to a module that throws the reason (`fail`).
 */
export class Imports {
	#imports: Record<string, string> = {};
	#scopes: Record<string, Record<string, string>> = {};
	#bound: Map<string, { url: string; via: string }> = new Map();
	#report: (code: string, message: string) => void;

	/**
	 * @param report Receives a binding the map cannot hold, as `PEER_CONTEXT_AMBIGUOUS`
	 */
	constructor(report: (code: string, message: string) => void = () => void 0) {
		this.#report = report;
	}

	/**
	 * The import map, with a `scopes` member only when an importer needs one
	 */
	get map(): { imports: Record<string, string>; scopes?: Record<string, Record<string, string>> } {
		const imports = { ...this.#imports };
		return Object.keys(this.#scopes).length ? { imports, scopes: structuredClone(this.#scopes) } : { imports };
	}

	/**
	 * @param specifier The public specifier an importer imports
	 * @param url Its address
	 * @param scope The package prefix of the importer, when it is one that can have a scope
	 */
	add(specifier: string, url: string, scope?: string): void {
		const current = this.#imports[specifier];
		if (current === void 0) {
			this.#imports[specifier] = url;
			return;
		}
		if (current === url || !scope) return;
		(this.#scopes[scope] ??= {})[specifier] = url;
	}

	/**
	 * Gives an importer of an installed graph the address of a specifier, unless this document gave it another one
	 *
	 * @param via The module of the workspace the path to the importer started from, which the report names
	 */
	bind(specifier: string, url: string, scope: string | undefined, via: string): void {
		this.#claim(specifier, url, scope, via) && this.add(specifier, url, scope);
	}

	/**
	 * Gives an importer of an installed graph, in its own scope, a module that throws why an import has no address
	 *
	 * @param reason The diagnostic of the import, which the module throws
	 */
	fail(specifier: string, reason: string, scope: string | undefined, via: string): void {
		const url = `data:text/javascript,${encodeURIComponent(`throw new Error(${JSON.stringify(`[beyond preview] ${reason}`)});`)}`;
		if (!scope || !this.#claim(specifier, url, scope, via)) return;
		(this.#scopes[scope] ??= {})[specifier] = url;
	}

	/**
	 * Records the address an importer is given for a specifier, unless this page gave it another one, which is reported
	 *
	 * @returns Whether the address can be written
	 */
	#claim(specifier: string, url: string, scope: string | undefined, via: string): boolean {
		const id = `${scope ?? ''}\n${specifier}`;
		const previous = this.#bound.get(id);
		if (!previous) return !!this.#bound.set(id, { url, via });
		if (previous.url === url) return true;

		const importer = scope ? `the package at ${scope}` : 'the document';
		const [first, second] = [previous.url, url].map(one => (one.startsWith('data:') ? 'no address' : one.split('?')[0]));
		const message =
			`${importer} imports "${specifier}" as ${first} through "${previous.via}" and as ${second} through "${via}": ` +
			'one page gives one release one address for each specifier it imports';
		this.#report('PEER_CONTEXT_AMBIGUOUS', message);
		return false;
	}
}
