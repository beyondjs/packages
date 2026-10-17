/**
 * The features of the host that its own clients use besides the development extension: the local Dev Server
 * settings, the launch of execution targets, dependency management, and production (package publication, web export
 * and the headless build). Each one lives in its own directory and exports a class with this shape:
 *
 * ```js
 * export class Feature {
 *   static NAME = 'launches';
 *   constructor(context) {}          // what the host gives every feature (below)
 *   async start() {}                 // optional: read what an earlier run left
 *   setup(app) {}                    // mounts its routes, before the compiled-module routes
 *   get capabilities() { return {}; } // what it implements, by name and major version, only when mounted and enabled
 *   async stop() {}                  // optional: release what it owns when the service ends
 * }
 * ```
 *
 * `context` is `{root, settings, workspace, events, holds, operations, services, log, journal, origins, environment}`: the canonical root,
 * the settings of the host (never the start token), the hosted workspace, the host's event bus (`events.emit(type,
 * data)` reaches the development extension's event stream), what keeps the service alive while work runs, the shared
 * long operations, the registry of the objects the development extension shares (`services.get('files')`,
 * `services.get('applications')`), the log, the service log its clients read (`journal`, `GET /logs`), the origins of the service once it listens (`origins.api()`,
 * `origins.preview()`), and the environment of the host. A feature that is not enabled for this
 * service (a launch on a service started without the `launch` setting, for example) mounts nothing and claims no
 * capability.
 */
export class Features {
	/**
	 * The features, in the order they are mounted, each loaded when the host starts
	 */
	static LIST = Object.freeze([
		['logs', () => import('./logs/index.mjs')],
		['settings', () => import('./settings/index.mjs')],
		['launches', () => import('./launches/index.mjs')],
		['tests', () => import('./tests/index.mjs')],
		['dependencies', () => import('./dependencies/index.mjs')],
		['production', () => import('./production/index.mjs')]
	]);

	#context;
	#features = [];

	/**
	 * @param {object} context What the host gives every feature
	 */
	constructor(context) {
		this.#context = context;
	}

	/**
	 * Loads and starts every feature; a feature that fails to load fails the start of the service, as an extension does
	 */
	async load() {
		for (const [name, load] of Features.LIST) {
			const module = await load();
			const Feature = module.Feature;
			if (typeof Feature !== 'function') throw new Error(`The host feature "${name}" exports no Feature class`);
			const feature = new Feature(this.#context);
			await feature.start?.();
			this.#features.push(feature);
		}
	}

	/**
	 * Mounts the routes of every feature
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#features.forEach(feature => feature.setup(app));
	}

	/**
	 * What the features implement, merged
	 *
	 * @returns {Record<string, number>}
	 */
	get capabilities() {
		return Object.assign({}, ...this.#features.map(feature => feature.capabilities ?? {}));
	}

	/**
	 * Releases what the features own, each within its own bound; a failure is logged and the others still stop
	 */
	async stop() {
		for (const feature of [...this.#features].reverse()) {
			await Promise.resolve(feature.stop?.()).catch(error => this.#context.log?.(`stopping a feature: ${error?.message ?? error}`));
		}
	}
}

/**
 * The objects the development extension shares with the host's features, by name: `files` (the source operations with
 * their revisions), `log` (its event log), `applications` (the catalog of applications and execution targets),
 * `selection` and `preview`. An object is there only while the extension that registered it is mounted.
 */
export class Services {
	#map = new Map();

	/**
	 * @param {string} name
	 * @param {unknown} service
	 */
	set(name, service) {
		this.#map.set(name, service);
	}

	/**
	 * @param {string} name
	 * @returns {any}
	 */
	get(name) {
		return this.#map.get(name);
	}

	/**
	 * @param {string} name
	 */
	has(name) {
		return this.#map.has(name);
	}
}
