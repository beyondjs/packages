import { Catalog } from './catalog.mjs';
import { Changes } from './changes.mjs';
import { Live } from './live.mjs';
import { SettingsRoutes } from './routes.mjs';
import { State } from './state.mjs';
import { Store } from './store.mjs';

/**
 * The local Dev Server settings a person may change from the Packages interface (`beyond-dev-settings/1`): a bounded
 * list (see `Catalog`) kept in `<root>/.beyond/settings.json`, outside every versioned declaration. Mounted by
 * `Features`; the contract is the suite's `docs/products/packages/developer-journey.md`, this repository's guide
 * `docs/settings.md`.
 *
 * - `GET /settings` answers the document: `{protocol, revision, settings: [{key, value, default, source, applies,
 *   editable, variable?}], diagnostics?}`; `PUT /settings {values}` with `If-Match: "<revision>"` changes every value
 *   it names or none (`SettingsRoutes`).
 * - A setting whose variable the service was started with is fixed (`source: environment`, not editable).
 * - `cdn.origin` and `previews.timeout` apply live: the host's environment is updated (`Live`) and the next
 *   description of a preview reads it. `launch.deno` and the variables of a target apply at the next launch, which
 *   reads them with `value(key)` (the feature is `services.get('settings')`). `workspace.timeout` applies when the
 *   service starts again (`Startup`).
 * - Every change announces `settings.changed {revision}` on the event stream, as does a change by hand that a read
 *   observes. Reads and writes of the file are done one at a time.
 *
 * A service that verifies delegated grants (`BEYOND_AUTHORITY`, a Workspace project environment) is configured by the
 * administration that grants them: there the feature mounts nothing, claims no capability and registers nothing.
 */
export class Feature {
	static NAME = 'settings';

	#context;
	#enabled;
	#catalog;
	#store;
	#live;
	#changes;
	#state;
	#started = false;
	#queue = Promise.resolve();

	/**
	 * @param {object} context What the host gives every feature (see `Features`)
	 * @param {{deno?: import('./deno.mjs').Deno}} [options] What checks a Deno executable, with the bound a test gives it
	 */
	constructor(context, { deno } = {}) {
		const environment = context.environment ?? process.env;
		this.#context = context;
		this.#enabled = !environment.BEYOND_AUTHORITY;
		// A service that launches nothing uses no Deno executable, and never runs one to check it
		this.#catalog = new Catalog(environment, { ...(deno ? { deno } : {}), launches: !!context.settings?.launch });
		this.#store = new Store(context.root);
		this.#live = new Live(this.#catalog, environment);
		this.#changes = new Changes(this.#catalog);
		// The defaults until the file is read
		this.#state = new State(Store.parse(), this.#catalog);
		this.#enabled && context.services?.set(Feature.NAME, this);
	}

	/**
	 * Whether this service offers its settings: not one that verifies delegated grants
	 */
	get enabled() {
		return this.#enabled;
	}

	/**
	 * Reads what an earlier run stored and applies the values that take effect live
	 */
	async start() {
		if (!this.#enabled) return;
		await this.#serial(() => this.#read());
		this.#started = true;
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#enabled && new SettingsRoutes(this).setup(app);
	}

	get capabilities() {
		return this.#enabled ? { settings: 1 } : {};
	}

	/**
	 * The value a setting has now: the environment's when it fixes it, else the stored one, else its default; undefined
	 * for a key that is not a setting. The variables of a target are an object, `{}` when none are stored.
	 *
	 * @param {string} key
	 */
	value(key) {
		const setting = this.#catalog.find(key);
		if (!setting) return;
		const value = setting.fixed ? setting.fixed.value : (this.#state.values[key] ?? setting.default);
		return value && typeof value === 'object' ? structuredClone(value) : value;
	}

	/**
	 * The document, read from the file now
	 */
	document() {
		return this.#serial(async () => {
			await this.#read();
			return this.#describe();
		});
	}

	/**
	 * Changes the values named, when the file still is at the revision the client read
	 *
	 * @param {unknown} values The `values` of the request
	 * @param {string} expected The revision of `If-Match`
	 * @returns {Promise<{outcome: 'completed' | 'conflict', document: object}>} The document after the change, or the
	 * current one when the file is at another revision and nothing was written
	 * @throws {import('./error.mjs').SettingsError} `400`, `403 SETTING_FIXED` or `422 SETTING_INVALID`
	 */
	async change(values, expected) {
		// Validated before the file is read: running a Deno executable does not hold the reads of other clients
		const parsed = await this.#changes.validate(values);
		return this.#serial(async () => {
			const current = await this.#read();
			if (current.revision !== expected) return { outcome: 'conflict', document: this.#describe() };
			// A change to the values the file already holds writes nothing, so its revision stays and nothing is announced
			const next = current.changed(parsed);
			if (JSON.stringify(next) !== JSON.stringify(current.stored)) await this.#store.write(next);
			await this.#read();
			return { outcome: 'completed', document: this.#describe() };
		});
	}

	/**
	 * Runs reads and writes of the file one at a time, so a slower read never replaces the state of a newer one
	 */
	#serial(work) {
		const run = this.#queue.then(work);
		this.#queue = run.catch(() => void 0);
		return run;
	}

	/**
	 * Reads the file; a new revision is applied live and announced
	 */
	async #read() {
		const state = new State(await this.#store.read(), this.#catalog);
		const changed = state.revision !== this.#state.revision;
		this.#state = state;
		if (!changed) return state;

		this.#live.apply(state.values);
		this.#started && this.#context.events?.emit('settings.changed', { revision: state.revision });
		return state;
	}

	#describe() {
		const { revision, values, diagnostics } = this.#state;
		const settings = this.#catalog.items(values);
		return { protocol: Catalog.PROTOCOL, revision, settings, ...(diagnostics.length ? { diagnostics } : {}) };
	}
}
