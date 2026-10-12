/**
 * Applies the settings that take effect live to the environment of the host, where the development extension reads
 * them at each use: `BEYOND_CDN_ORIGIN` when the preview addresses a module on the CDN, `BEYOND_PREVIEW_CDN_TIMEOUT`
 * when it checks one. The next description of a preview reads the new value; nothing restarts.
 *
 * A setting the environment fixes is never written. A stored value is written as its variable, and a value set back
 * to its default as an empty variable, which those readers take as no value: it replaces what an earlier change
 * wrote and, unlike a removed variable, also replaces the value a reader was created with. Processes the service
 * starts afterwards inherit the same values.
 */
export class Live {
	#catalog;
	#environment;

	/**
	 * @param {import('./catalog.mjs').Catalog} catalog
	 * @param {Record<string, string | undefined>} environment The environment of the host (`process.env`)
	 */
	constructor(catalog, environment) {
		this.#catalog = catalog;
		this.#environment = environment;
	}

	/**
	 * @param {Record<string, unknown>} values The valid values the settings file stores, by key
	 */
	apply(values) {
		for (const setting of this.#catalog.settings) {
			if (setting.applies !== 'live' || !setting.variable || setting.fixed) continue;
			const value = values[setting.key];
			if (value !== void 0) this.#environment[setting.variable] = String(value);
			else if (this.#environment[setting.variable] !== void 0) this.#environment[setting.variable] = '';
		}
	}
}
