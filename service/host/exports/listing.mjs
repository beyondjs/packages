/**
 * What the archive of a package holds and what it left out, by path and never by content: the files it holds, in the
 * order of the archive, and what it left out by reason (`ignored`, `secrets`, `links`, `members`, `internal`), a
 * directory left out whole named once with its ending slash. Each list of left-out paths keeps its first
 * `Listing.LIMIT` paths, and `omitted` counts the rest.
 *
 * ```js
 * const listing = new Listing();
 * listing.include('src/index.ts');
 * listing.exclude('secrets', '.env');
 * listing.toJSON();   // {files: ['src/index.ts'], excluded: {secrets: ['.env']}}
 * ```
 */
export class Listing {
	static LIMIT = 1000;
	static REASONS = Object.freeze(['ignored', 'secrets', 'links', 'members', 'internal']);

	#files = [];
	#excluded = Object.fromEntries(Listing.REASONS.map(reason => [reason, []]));
	#omitted = {};

	/**
	 * The files the archive holds
	 */
	get files() {
		return [...this.#files];
	}

	/**
	 * @param {string} path
	 */
	include(path) {
		this.#files.push(path);
	}

	/**
	 * @param {'ignored' | 'secrets' | 'links' | 'members' | 'internal'} reason
	 * @param {string} path A file, or a directory with its ending slash
	 */
	exclude(reason, path) {
		const list = this.#excluded[reason];
		if (list.length < Listing.LIMIT) return void list.push(path);
		this.#omitted[reason] = (this.#omitted[reason] ?? 0) + 1;
	}

	/**
	 * The listing as an export describes a package: `{files, excluded, omitted?}`
	 */
	toJSON() {
		const excluded = Object.fromEntries(Object.entries(this.#excluded).map(([reason, paths]) => [reason, [...paths]]));
		return { files: this.files, excluded, ...(Object.keys(this.#omitted).length ? { omitted: { ...this.#omitted } } : {}) };
	}
}
