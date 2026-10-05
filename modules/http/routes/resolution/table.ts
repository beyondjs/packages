/**
 * The imports and scopes of a resolution while it is written.
 *
 * The first URL a specifier is given is its import. An importer that resolves the specifier to another URL gets
 * it in the scope of its package prefix; one that resolves the same URL needs no scope.
 *
 * A specifier several local versions of a workspace publish has no import at all: whichever came first would be
 * given to every consumer by the order of the workspace. Each of its importers gets it in its own scope, and each
 * version is addressed by its own path.
 */
export class Table {
	#shared: (specifier: string) => boolean;

	/**
	 * @param shared Whether several local versions publish a specifier
	 */
	constructor(shared: (specifier: string) => boolean = () => false) {
		this.#shared = shared;
	}

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
		if (this.#shared(specifier)) {
			importer && ((this.#scopes[importer] ??= {})[specifier] = url);
			return;
		}

		const current = this.#imports[specifier];
		if (current === void 0) {
			this.#imports[specifier] = url;
			return;
		}
		if (current === url || !importer) return;
		(this.#scopes[importer] ??= {})[specifier] = url;
	}
}
