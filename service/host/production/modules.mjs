/**
 * The public modules of Packages that production work uses, loaded the first time they are needed rather than when
 * the service starts: the readers of publication forms and of `exports` (`@beyond-js/packages/publication`), the
 * provider settings that read npm's configuration (`@beyond-js/packages/providers/settings`), and the preview that
 * describes a page's graph (`@beyond-js/packages/development`). They are imported by their public specifiers, so the
 * loader of the host decides where they come from, as for every module of the host.
 *
 * A test gives its own (`new Modules(loaded)`), with the same members.
 *
 * ```js
 * const { Publication, Exports } = await modules.publication();
 * const settings = await modules.settings(options);   // loaded ProvidersSettings
 * const { Preview } = await modules.development();
 * ```
 */
export class Modules {
	#given;
	#loaded = new Map();

	/**
	 * @param {{publication?: () => Promise<object>, settings?: (options: object) => Promise<object>, development?: () =>
	 * Promise<object>}} [given] Stand-ins for what would be imported
	 */
	constructor(given = {}) {
		this.#given = given;
	}

	#import(specifier) {
		if (!this.#loaded.has(specifier)) {
			const loading = import(specifier);
			loading.catch(() => this.#loaded.delete(specifier));
			this.#loaded.set(specifier, loading);
		}
		return this.#loaded.get(specifier);
	}

	/**
	 * `{Publication, Exports}`
	 */
	publication() {
		return this.#given.publication ? this.#given.publication() : this.#import('@beyond-js/packages/publication');
	}

	/**
	 * The provider settings of a package directory, loaded: what npm's configuration says of its registries and
	 * credentials
	 *
	 * @param {{path: string, workspace: string, env: object, user?: string}} options
	 */
	async settings(options) {
		if (this.#given.settings) return this.#given.settings(options);
		const { ProvidersSettings } = await this.#import('@beyond-js/packages/providers/settings');
		const settings = new ProvidersSettings(options);
		await settings.load();
		return settings;
	}

	/**
	 * `{Preview}`
	 */
	development() {
		return this.#given.development ? this.#given.development() : this.#import('@beyond-js/packages/development');
	}
}
