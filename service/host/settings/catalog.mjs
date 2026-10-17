import { Deno } from './deno.mjs';
import { Executable, Milliseconds, Origin, Origins, Variables } from './values.mjs';

/**
 * One setting: its key, the value it has when nothing sets it, when a change applies (`live`, at the next `launch`,
 * or when the service starts again: `restart`), the environment variable that sets it, and the kind of its value.
 * A setting whose variable the service was started with is fixed: its value is the environment's and no request
 * changes it. One this service does not use is unavailable (`reason`): it is listed, not editable, and no request
 * changes it.
 */
export class Setting {
	/**
	 * Why a setting the environment fixes is not editable, in the words a person reads; the variable is named apart
	 * (`variable`), for technical details only
	 */
	static FIXED = Object.freeze({ code: 'SETTING_FIXED', message: 'Set when the server was started; start it again to change it' });

	#key;
	#variable;
	#default;
	#applies;
	#kind;
	#fixed;
	#unavailable;

	/**
	 * @param {{key: string, variable?: string, default: unknown, applies: 'live' | 'launch' | 'restart', kind: object,
	 * unavailable?: {code: string, message: string}}} specs
	 * @param {Record<string, string | undefined>} [environment] The environment the service started with
	 */
	constructor({ key, variable, default: value, applies, kind, unavailable }, environment = {}) {
		this.#key = key;
		this.#unavailable = unavailable;
		this.#variable = variable;
		this.#default = value;
		this.#applies = applies;
		this.#kind = kind;
		const given = variable ? environment[variable] : void 0;
		// An empty variable is no value, as the readers of these variables take it
		this.#fixed = given !== void 0 && given !== '' ? { value: kind.environment(given) } : void 0;
	}

	get key() {
		return this.#key;
	}

	get variable() {
		return this.#variable;
	}

	get default() {
		return this.#default;
	}

	get applies() {
		return this.#applies;
	}

	get kind() {
		return this.#kind;
	}

	/**
	 * The value the environment fixes, as `{value}`, or undefined when the setting can be changed
	 */
	get fixed() {
		return this.#fixed;
	}

	/**
	 * Why this service does not use the setting, as `{code, message}`, or undefined when it does
	 */
	get unavailable() {
		return this.#unavailable;
	}

	/**
	 * What the document says of this setting, given the value the settings file stores for it (undefined for none)
	 *
	 * @param {unknown} stored
	 */
	item(stored) {
		const described = { key: this.#key, default: this.#default, applies: this.#applies, ...(this.#variable ? { variable: this.#variable } : {}) };
		if (this.#fixed) return { ...described, value: this.#fixed.value, source: 'environment', editable: false, reason: { ...Setting.FIXED } };
		const value = stored !== void 0 ? { value: stored, source: 'file' } : { value: this.#default, source: 'default' };
		if (this.#unavailable) return { ...described, ...value, editable: false, reason: { ...this.#unavailable } };
		return { ...described, ...value, editable: true };
	}
}

/**
 * The bounded list of local Dev Server settings (`beyond-dev-settings/1`), in the order the document lists them.
 * Nothing here is machine administration: no port, bind address, pairing, credential or CDN embedding.
 *
 * | Key | Value | Applies | Variable |
 * | --- | --- | --- | --- |
 * | `cdn.origin` | The CDN origin of `externals: cdn` previews (https, or http on a loopback name), or null | `live` | `BEYOND_CDN_ORIGIN` |
 * | `snapshots.origins` | More Snapshots origins a source export may be uploaded to, besides the family's own | `live` | `BEYOND_SNAPSHOTS_ORIGINS` |
 * | `previews.timeout` | Milliseconds of each CDN check of a preview, 500–30000 | `live` | `BEYOND_PREVIEW_CDN_TIMEOUT` |
 * | `launch.deno` | The absolute path of a Deno 2 executable, or null | `launch` | `BEYOND_DENO` |
 * | `targets.<application>.<target>.environment` | Variables given to a launched backend | `launch` | None |
 * | `workspace.timeout` | Milliseconds the workspace is given to be read, 10000–600000 | `restart` | `BEYOND_WORKSPACE_TIMEOUT` |
 */
export class Catalog {
	static PROTOCOL = 'beyond-dev-settings/1';

	/**
	 * The key of a target's variables, with the application and target identifiers of the applications catalog
	 */
	static #TARGET = /^targets\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z][a-z0-9-]{0,31})\.environment$/;

	#settings;
	#variables = new Variables();

	/**
	 * Why `launch.deno` is unavailable on a service that launches nothing: it is never used there, and no executable is
	 * run to check it
	 */
	static LAUNCH = Object.freeze({
		code: 'LAUNCH_UNAVAILABLE',
		message: 'This development service launches no execution target (it was started without the launch setting, which beyond run gives), so it uses no Deno executable and runs none'
	});

	/**
	 * @param {Record<string, string | undefined>} environment The environment the service started with
	 * @param {{deno?: Deno, launches?: boolean}} [options] What checks a Deno executable, and whether the service
	 * launches execution targets
	 */
	constructor(environment, { deno = new Deno({ environment }), launches = true } = {}) {
		const executable = { key: 'launch.deno', variable: 'BEYOND_DENO', default: null, applies: 'launch', kind: new Executable(deno), ...(launches ? {} : { unavailable: Catalog.LAUNCH }) };
		const specs = [
			{ key: 'cdn.origin', variable: 'BEYOND_CDN_ORIGIN', default: null, applies: 'live', kind: new Origin() },
			{ key: 'snapshots.origins', variable: 'BEYOND_SNAPSHOTS_ORIGINS', default: [], applies: 'live', kind: new Origins() },
			{ key: 'previews.timeout', variable: 'BEYOND_PREVIEW_CDN_TIMEOUT', default: 5000, applies: 'live', kind: new Milliseconds(500, 30000) },
			executable,
			{ key: 'workspace.timeout', variable: 'BEYOND_WORKSPACE_TIMEOUT', default: 120000, applies: 'restart', kind: new Milliseconds(10000, 600000) }
		];
		this.#settings = new Map(specs.map(spec => [spec.key, new Setting(spec, environment)]));
	}

	/**
	 * The settings with a key of their own, in the order of the document
	 */
	get settings() {
		return [...this.#settings.values()];
	}

	/**
	 * Whether a key names a target's variables
	 *
	 * @param {string} key
	 */
	static target(key) {
		return typeof key === 'string' && Catalog.#TARGET.test(key);
	}

	/**
	 * The setting of a key, undefined for a key that is not one
	 *
	 * @param {string} key
	 */
	find(key) {
		if (this.#settings.has(key)) return this.#settings.get(key);
		if (!Catalog.target(key)) return;
		return new Setting({ key, default: {}, applies: 'launch', kind: this.#variables });
	}

	/**
	 * The settings of the document, given the values the settings file stores: the ones with a key of their own and
	 * the variables of every target the file stores, which follow `launch.deno` sorted by key
	 *
	 * @param {Record<string, unknown>} stored
	 */
	items(stored) {
		const targets = Object.keys(stored).filter(key => Catalog.target(key)).sort().map(key => this.find(key));
		const [cdn, snapshots, previews, deno, workspace] = this.settings;
		return [cdn, snapshots, previews, deno, ...targets, workspace].map(setting => setting.item(stored[setting.key]));
	}
}
