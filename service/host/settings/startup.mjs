import { Catalog } from './catalog.mjs';
import { State } from './state.mjs';
import { Store } from './store.mjs';

/**
 * The settings that apply when the service starts again (`applies: restart`, today `workspace.timeout`), for a host
 * that is starting: the environment it started with, completed with the stored value of each such setting whose
 * variable that environment does not set. The host reads its bounds from the result, before its features exist; it
 * leaves its own environment as it was, so the settings feature still tells a value the environment fixes from a
 * stored one.
 *
 * ```js
 * const environment = new Startup(settings.root).environment(process.env);
 * const reading = new Deadline('BEYOND_WORKSPACE_TIMEOUT', 120000).read(environment);
 * ```
 *
 * A settings file that cannot be read, one the service did not write (`Store`), or a stored value this service refuses,
 * completes nothing: the defaults of the host apply, and the settings document reports the file.
 */
export class Startup {
	#store;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#store = new Store(root);
	}

	/**
	 * @param {Record<string, string | undefined>} [environment] The environment the host started with
	 * @returns {Record<string, string | undefined>} A copy of it, completed
	 */
	environment(environment = process.env) {
		const catalog = new Catalog(environment);
		const { values } = new State(this.#store.load(), catalog);

		const completed = { ...environment };
		for (const setting of catalog.settings) {
			if (setting.applies !== 'restart' || setting.fixed || values[setting.key] === void 0) continue;
			completed[setting.variable] = String(values[setting.key]);
		}
		return completed;
	}
}
