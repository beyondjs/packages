/**
 * The development selection a web export describes its page with, in place of the person's: every package of the
 * workspace in development (so the export compiles them from their sources, never from a CDN), and the externals of
 * the strategy (`environment` for a self-contained export, `cdn` to reference installed packages on the CDN). It has
 * the two members `Preview` reads of a selection, and nothing is stored: the person's selection is left as it is.
 *
 * ```js
 * new Preview(delivery, new Selected('cdn'), runtime, environment);
 * ```
 */
export class Selected {
	#externals;

	/**
	 * @param {'environment' | 'cdn'} externals
	 */
	constructor(externals) {
		this.#externals = externals;
	}

	/**
	 * The selection as a preview reads it
	 */
	async read() {
		return { explicit: false, packages: [], modules: [], externals: this.#externals, unknown: [] };
	}

	/**
	 * Every module of the workspace is in development
	 */
	covers() {
		return true;
	}
}
