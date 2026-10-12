/**
 * The settings file as this service reads it against the catalog: the valid values by key, and a diagnostic for each
 * entry it does not use (a key it does not know, as a newer service may write, or a value it refuses, as a change by
 * hand may leave). Entries it does not use are kept when it writes, so an unrelated change never discards them; a
 * change of their key replaces them. A file the service did not write (`SETTINGS_FILE_UNTRUSTED`) arrives as no values
 * with its diagnostic. A value is read as the file holds it (`parse(value, {stored: true})`): the reserved names of a
 * target's variables are kept, and the launch ignores them and says so.
 */
export class State {
	#revision;
	#stored;
	#values = {};
	#diagnostics = [];

	/**
	 * @param {{revision: string, values: Record<string, unknown>, problem?: {code: string, message: string}}} read What
	 * the store read
	 * @param {import('./catalog.mjs').Catalog} catalog
	 */
	constructor({ revision, values, problem }, catalog) {
		this.#revision = revision;
		this.#stored = { ...values };
		problem && this.#diagnostics.push(problem);

		for (const [key, value] of Object.entries(values)) {
			const setting = catalog.find(key);
			if (!setting) {
				this.#diagnostics.push({ key, code: 'SETTING_UNKNOWN', message: `.beyond/settings.json holds "${key}", which is not a setting of this service: it is kept and not used` });
				continue;
			}
			const parsed = setting.kind.parse(value, { stored: true });
			if (parsed.message) {
				this.#diagnostics.push({ key, code: 'SETTING_INVALID', message: `.beyond/settings.json holds a value of "${key}" that is refused (${parsed.message}): the default applies` });
				continue;
			}
			parsed.value !== null && (this.#values[key] = parsed.value);
		}
	}

	get revision() {
		return this.#revision;
	}

	/**
	 * The valid values the file stores, by key
	 */
	get values() {
		return this.#values;
	}

	get diagnostics() {
		return this.#diagnostics;
	}

	/**
	 * Every entry the file holds, the ones this service does not use included
	 */
	get stored() {
		return { ...this.#stored };
	}

	/**
	 * What the file holds after a change: every entry it holds, with each changed key set to its parsed value, or
	 * removed for null (the default)
	 *
	 * @param {Record<string, unknown>} changes Parsed values by key
	 */
	changed(changes) {
		const next = { ...this.#stored };
		Object.entries(changes).forEach(([key, value]) => (value === null ? delete next[key] : (next[key] = value)));
		return next;
	}
}
