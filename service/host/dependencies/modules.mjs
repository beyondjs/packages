/**
 * The public modules of Packages that dependency management uses: `Installation` (`@beyond-js/packages/installation`),
 * which resolves, reads releases and installs, and `Execution` (`@beyond-js/packages/execution`), which reads the
 * projection. They are imported the first time they are needed, through the loader of the host, so a service that
 * never manages its dependencies does not load them; a test gives stand-ins instead.
 *
 * ```js
 * const modules = new Modules();                                   // the real ones
 * const modules = new Modules({ Installation, Execution });        // stand-ins
 * const Installation = await modules.installation();
 * ```
 */
export class Modules {
	#given;
	#installation;
	#execution;

	/**
	 * @param {{Installation?: Function, Execution?: object}} [given] Classes that stand in for the real ones
	 */
	constructor(given = {}) {
		this.#given = given;
	}

	/**
	 * @returns {Promise<Function>} The `Installation` class
	 */
	installation() {
		if (this.#given.Installation) return Promise.resolve(this.#given.Installation);
		return (this.#installation ??= import('@beyond-js/packages/installation').then(module => module.Installation));
	}

	/**
	 * @returns {Promise<object>} The `Execution` class
	 */
	execution() {
		if (this.#given.Execution) return Promise.resolve(this.#given.Execution);
		return (this.#execution ??= import('@beyond-js/packages/execution').then(module => module.Execution));
	}
}
