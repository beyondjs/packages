import { SettingsError } from './error.mjs';

/**
 * The values a request asks to change, validated whole before anything is written: a key the environment fixes is
 * refused (`403 SETTING_FIXED`, naming the keys, with the variables that fix them in `details`), so is one this service does not use (`403 SETTING_UNAVAILABLE`: a
 * Deno executable on a service that launches nothing, which runs no executable to check it), and an unknown key or a
 * refused value is reported with one diagnostic per key (`422 SETTING_INVALID`), so a request changes every value it
 * names or none. What only running a value tells (a Deno executable answering `--version`) is checked once every value
 * is otherwise valid.
 */
export class Changes {
	/**
	 * The most keys one request changes
	 */
	static LIMIT = 200;

	#catalog;

	/**
	 * @param {import('./catalog.mjs').Catalog} catalog
	 */
	constructor(catalog) {
		this.#catalog = catalog;
	}

	static #invalid(diagnostics) {
		const keys = diagnostics.map(({ key }) => key).join(', ');
		return new SettingsError(422, 'SETTING_INVALID', `Nothing was changed: ${keys} cannot take the values given`, { diagnostics });
	}

	/**
	 * @param {unknown} values The `values` of the request, by key; null sets a key back to its default
	 * @returns {Promise<Record<string, unknown>>} The parsed values, by key
	 * @throws {SettingsError} `400 BODY_INVALID`, `403 SETTING_FIXED`, `403 SETTING_UNAVAILABLE` or `422 SETTING_INVALID`
	 */
	async validate(values) {
		if (!values || typeof values !== 'object' || Array.isArray(values)) {
			throw new SettingsError(400, 'BODY_INVALID', 'A change of the settings is {"values": {"<key>": <value>, …}}, null setting a key back to its default');
		}
		const keys = Object.keys(values);
		if (keys.length > Changes.LIMIT) throw new SettingsError(400, 'BODY_INVALID', `A change names at most ${Changes.LIMIT} settings`);

		const fixed = keys.filter(key => this.#catalog.find(key)?.fixed);
		if (fixed.length) {
			const variables = fixed.map(key => this.#catalog.find(key).variable);
			const message = `Nothing was changed: ${fixed.join(', ')} ${fixed.length > 1 ? 'were' : 'was'} set when the server was started; start it again to change ${fixed.length > 1 ? 'them' : 'it'}`;
			throw new SettingsError(403, 'SETTING_FIXED', message, { keys: fixed, details: { variables } });
		}

		const unavailable = keys.filter(key => this.#catalog.find(key)?.unavailable);
		if (unavailable.length) {
			const { message } = this.#catalog.find(unavailable[0]).unavailable;
			throw new SettingsError(403, 'SETTING_UNAVAILABLE', `Nothing was changed: ${unavailable.join(', ')} cannot be changed here. ${message}`, { keys: unavailable });
		}

		const diagnostics = [];
		const parsed = {};
		for (const key of keys) {
			const setting = this.#catalog.find(key);
			if (!setting) {
				diagnostics.push({ key, code: 'SETTING_UNKNOWN', message: `"${key}" is not a setting of this service` });
				continue;
			}
			const result = setting.kind.parse(values[key]);
			result.message ? diagnostics.push({ key, code: 'SETTING_INVALID', message: `${key}: ${result.message}` }) : (parsed[key] = result.value);
		}
		if (diagnostics.length) throw Changes.#invalid(diagnostics);

		for (const key of keys) {
			const { kind } = this.#catalog.find(key);
			const verified = kind.verify ? await kind.verify(parsed[key]) : {};
			verified.message && diagnostics.push({ key, code: 'SETTING_INVALID', message: `${key}: ${verified.message}` });
		}
		if (diagnostics.length) throw Changes.#invalid(diagnostics);
		return parsed;
	}
}
