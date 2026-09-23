/**
 * The imports and scopes of a resolution while it is written.
 *
 * The first URL a specifier is given is its import. An importer that resolves the specifier to another URL gets
 * it in the scope of its package prefix; one that resolves the same URL needs no scope.
 */
export class Table {
	#imports: Record<string, string> = {};
	get imports() {
		return this.#imports;
	}

	#scopes: Record<string, Record<string, string>> = {};
	get scopes() {
		return this.#scopes;
	}

	/**
	 * @param specifier A public specifier
	 * @param url Its origin-relative URL
	 * @param importer The package prefix of the importer that resolved it (`/m/<package>@<version>/`), if any
	 */
	add(specifier: string, url: string, importer?: string): void {
		const current = this.#imports[specifier];
		if (current === void 0) {
			this.#imports[specifier] = url;
			return;
		}
		if (current === url || !importer) return;
		(this.#scopes[importer] ??= {})[specifier] = url;
	}
}
