/**
 * The import map of a preview while its graph is walked.
 *
 * The first address a specifier is given is its import: the version the entry reaches first. An importer that
 * resolves the specifier to another address, such as a package that installs its own version of a library, gets
 * it in the scope of its package prefix, as a release does; one that resolves the same address needs no scope.
 * Scope keys are addresses like the imports: relative to the document for this environment, on the CDN origin
 * otherwise.
 */
export class Imports {
	#imports: Record<string, string> = {};
	#scopes: Record<string, Record<string, string>> = {};

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
}
