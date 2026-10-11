/**
 * What a service implements, as `GET /session` lists it in `capabilities`: a capability name and the major version
 * of it the service implements. A client decides with it, before any tool is used, whether the service is
 * compatible, partially supported or incompatible; the versions of the packages being developed never decide it.
 *
 * The host always serves `state` (`/state`) and `installation` (`/installation`). The capabilities of the
 * development extension are read from the routes the service actually mounted, so a service started without the
 * extension, or with a version that lacks a route, does not claim it:
 *
 * | Capability | Mounted route |
 * | --- | --- |
 * | `files` | `GET /files/tree` |
 * | `events` | `GET /events` |
 * | `builds` | `POST /builds` |
 * | `declarations` | `GET /declarations/*` |
 * | `selection` | `GET /development/selection` |
 * | `preview` | `GET /preview` |
 * | `composition` | `GET /preview/composition.json` |
 *
 * The features of the host itself (`pairing`, `exports`, `ui`) are added by whoever mounted them.
 */
export class Capabilities {
	static BASE = Object.freeze({ state: 1, installation: 1 });

	static ROUTES = Object.freeze([
		['files', 'get', '/files/tree'],
		['events', 'get', '/events'],
		['builds', 'post', '/builds'],
		['declarations', 'get', '/declarations/*'],
		['selection', 'get', '/development/selection'],
		['preview', 'get', '/preview'],
		['composition', 'get', '/preview/composition.json']
	]);

	#map = { ...Capabilities.BASE };

	/**
	 * The capabilities, by name
	 *
	 * @returns {Record<string, number>}
	 */
	get map() {
		return { ...this.#map };
	}

	/**
	 * Adds the capabilities of a feature of the host
	 *
	 * @param {Record<string, number>} capabilities
	 */
	add(capabilities) {
		Object.assign(this.#map, capabilities);
	}

	/**
	 * Reads the routes an application mounted, once every route is mounted
	 *
	 * @param {import('express').Application} app
	 */
	read(app) {
		const mounted = Capabilities.#mounted(app);
		for (const [name, method, path] of Capabilities.ROUTES) {
			if (mounted.some(route => route.path === path && route.methods[method])) this.#map[name] = 1;
		}
	}

	/**
	 * The routes of an Express application: its router's layers that are routes, with their path and methods
	 */
	static #mounted(app) {
		const stack = app?._router?.stack ?? app?.router?.stack ?? [];
		return stack.filter(layer => layer.route && typeof layer.route.path === 'string').map(layer => layer.route);
	}
}
