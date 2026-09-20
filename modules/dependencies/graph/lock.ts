/**
 * The releases pinned by a previous resolution. While a pinned release still satisfies what is required,
 * it is selected again instead of a newer one, so the same lock and inputs always give the same graph.
 *
 * Accepted forms: another `Lock`, a list of `{name, version}`, a `beyond-graph/1` document (its `nodes`)
 * and the content of a project lock file (`{'name@version': {name, version: {resolved}}}`).
 */
export /*bundle*/ class Lock {
	#versions: Map<string, Set<string>> = new Map();

	get size() {
		return this.#versions.size;
	}

	constructor(value?: any) {
		if (!value) return;
		if (value instanceof Lock) {
			value.#versions.forEach((versions, name) => this.#versions.set(name, new Set(versions)));
			return;
		}

		const entries: any[] = Array.isArray(value)
			? value
			: Object.values(typeof value.nodes === 'object' && value.nodes ? value.nodes : value);

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') continue;
			const version = typeof entry.version === 'string' ? entry.version : entry.version?.resolved;
			if (typeof version === 'string') this.pin(entry.name, version);
		}
	}

	pin(name: string, version: string) {
		if (!this.#versions.has(name)) this.#versions.set(name, new Set());
		this.#versions.get(name).add(version);
	}

	/**
	 * The pinned versions of a package, in no particular order
	 */
	versions(name: string): string[] {
		return [...(this.#versions.get(name) || [])];
	}
}
