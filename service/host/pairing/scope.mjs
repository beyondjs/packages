import { ResourcePath } from '@beyond-js/artifact-api';

/**
 * Which routes each caller of a service that pairs reaches, by method and path, read as the routes of the service
 * match them: without regard to case, and without an ending slash.
 *
 * - `preview`: what the preview listener serves, `GET` and `HEAD` only: the preview (`/preview`, `/preview/…`, its
 *   entry and composition documents), compiled modules and their updates (`/m/`, `/u/`), the resolution documents
 *   and the build events (`/events`), code for browsers only (`foreign`).
 * - `reads`: what a local consumer reads on the API listener: the session and the identity of the service (`/`),
 *   the state, the selection of a module (`/selection`), the state of the installation (`GET /installation`), the
 *   compiled modules and updates, the resolution documents, the build events, the attachments and the preview.
 * - `visitor`: what anyone reaches on the API listener: `POST /pairing` and the static files of the interface (`/ui/`).
 *
 * `compiled` names the routes of the compiled-module contract, whose cross-origin rules are that contract's.
 */
export class Scope {
	static #COMPILED = /^\/(m|u)\/|^\/(resolution|importmap)\.json$/;
	static #PREVIEW = /^\/(m|u)\/|^\/(resolution|importmap)\.json$|^\/preview(\/.*)?$|^\/events$/;
	static #READS = /^\/$|^\/(session|state|selection|installation|events|attach)$|^\/(m|u)\/|^\/(resolution|importmap)\.json$|^\/preview(\/.*)?$/;
	static #INTERFACE = /^\/ui(\/.*)?$/;

	/**
	 * A path as the routes of the service read it: in lower case, without an ending slash (the root stays `/`)
	 *
	 * @param {string} path
	 */
	static normalized(path) {
		return String(path).toLowerCase().replace(/\/+$/, '') || '/';
	}

	/**
	 * Tests a pattern against a path as the routes read it, with and without its ending slash
	 */
	static #test(pattern, path) {
		const normalized = Scope.normalized(path);
		return pattern.test(normalized) || pattern.test(`${normalized}/`);
	}

	static #read(method) {
		return method === 'GET' || method === 'HEAD';
	}

	/**
	 * Whether a path answers under the compiled-module contract
	 *
	 * @param {string} path
	 */
	static compiled(path) {
		return Scope.#test(Scope.#COMPILED, path);
	}

	/**
	 * Whether the preview listener serves a request
	 *
	 * @param {string} method
	 * @param {string} path
	 */
	static preview(method, path) {
		return Scope.#read(method) && Scope.#test(Scope.#PREVIEW, path);
	}

	/**
	 * Whether a local consumer may send a request
	 *
	 * @param {string} method
	 * @param {string} path
	 */
	static reads(method, path) {
		return Scope.#read(method) && Scope.#test(Scope.#READS, path);
	}

	/**
	 * Whether anyone may send a request to the API listener
	 *
	 * @param {string} method
	 * @param {string} path
	 */
	static visitor(method, path) {
		if (method === 'POST') return Scope.normalized(path) === '/pairing';
		return Scope.#read(method) && Scope.#test(Scope.#INTERFACE, path);
	}

	/**
	 * The target a request of the compiled-module contract asks for: `browser`, `node`, or undefined when it names
	 * none (a resolution document without a query is the Node document of the session)
	 *
	 * @param {{query: Record<string, unknown>}} request
	 */
	static target(request) {
		const { target } = request.query ?? {};
		return typeof target === 'string' ? target : void 0;
	}

	/**
	 * What a path of the compiled-module contract addresses: `resolution` for a resolution document, the kind of the
	 * resource of a module path or an update (`module`, `style`, `map`, `asset`), or undefined for any other path and
	 * for an address its route refuses as malformed
	 *
	 * @param {string} path
	 */
	static kind(path) {
		if (/^\/(resolution|importmap)\.json\/?$/i.test(path)) return 'resolution';
		const update = /^\/u\/[^/]+(\/.*)$/i.exec(path);
		const address = update ? `/m${update[1]}` : path;
		if (!/^\/m\//i.test(address)) return;
		try {
			return ResourcePath.parse(address, ['registry', 'git', 'digest']).kind;
		} catch {
			// Malformed: the route answers it with the error of the contract
		}
	}

	/**
	 * Whether the preview listener refuses a request of the compiled-module contract for the target it names. Code (a
	 * module, its map, or the update of one) is refused for any target it names but `browser`, and a resolution
	 * document for any target but `browser`, since one that names none is the Node document of the session.
	 * Stylesheets and declared assets are the same for every target: they are served whatever target their address
	 * names, and an asset's address names none. A module address that names no target is answered by its route
	 * (`OPTION_INVALID`).
	 *
	 * @param {{path: string, query: Record<string, unknown>}} request
	 */
	static foreign(request) {
		const kind = Scope.kind(request.path);
		const target = Scope.target(request);
		if (kind === 'resolution') return target !== 'browser';
		if (kind === 'style' || kind === 'asset') return false;
		return Scope.compiled(request.path) && target !== void 0 && target !== 'browser';
	}
}
