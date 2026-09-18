/**
 * What the caller of the service adds to its host.
 *
 * An extension is a module specifier given when the service is started. It is imported in the host, so it is
 * resolved by the loader of the host: a public module of the implementation (`@beyond-js/packages/...`) is
 * the one the bootstrap compiles, and a `file:` URL is a plain module. It exports either or both of:
 *
 * ```js
 * export async function guard(app, { workspace, delivery, settings }) {}   // before every route of the service
 * export async function setup(app, { workspace, delivery, settings }) {}   // after them, before the error handler
 * ```
 *
 * The service has no authentication of its own. `guard` is where a caller that exposes the service beyond
 * the loopback address adds the middleware that decides who reaches it, the compiled modules, the session
 * description, the state and the attachment stream included. `setup` adds routes, whose failures are
 * answered in the shape of the contract.
 *
 * `workspace` and `delivery` are the same object: the hosted workspace, which stays valid when the Packages
 * workspace behind it is reloaded after a manifest change. An extension holds that object and never a
 * Packages workspace of its own. `settings` are the ones of the service (`root`, `standalone`, `bind`, …)
 * without the token that proves who started it. Extensions run in the order given. One that cannot be
 * imported, exports neither function or fails fails the start of the service: a service that silently lacks
 * its access control or part of its API is worse than none.
 */
export class Extensions {
	#specifiers;
	#modules = [];

	/**
	 * @param {unknown} specifiers The `extensions` setting
	 */
	constructor(specifiers = []) {
		if (!(specifiers instanceof Array) || specifiers.some(one => typeof one !== 'string' || !one)) {
			throw new Error('The "extensions" of the service must be a list of module specifiers');
		}
		this.#specifiers = specifiers;
	}

	/**
	 * Imports the extensions, once
	 */
	async load() {
		for (const specifier of this.#specifiers) {
			try {
				const module = await import(specifier);
				if (typeof module.guard !== 'function' && typeof module.setup !== 'function') {
					throw new Error('it exports neither guard() nor setup()');
				}
				this.#modules.push({ specifier, module });
			} catch (error) {
				throw new Error(`The service extension "${specifier}" could not be loaded: ${error.message}`);
			}
		}
	}

	async #call(name, app, { workspace, settings }) {
		const { token, ...visible } = settings;

		for (const { specifier, module } of this.#modules) {
			if (typeof module[name] !== 'function') continue;
			try {
				await module[name](app, { workspace, delivery: workspace, settings: visible });
			} catch (error) {
				throw new Error(`The ${name}() of the service extension "${specifier}" failed: ${error.message}`);
			}
		}
	}

	/**
	 * Lets the extensions mount what must run before the routes of the service
	 */
	guard(app, context) {
		return this.#call('guard', app, context);
	}

	/**
	 * Lets the extensions mount their routes
	 */
	setup(app, context) {
		return this.#call('setup', app, context);
	}
}
