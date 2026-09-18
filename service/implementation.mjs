/**
 * How the implementation of Packages gets into the host process of a development service.
 *
 * Packages is written in Beyond, so its public modules (`@beyond-js/packages/workspace`, …) exist in two
 * forms, and which one an installation has decides what has to happen before the host starts:
 *
 * - **Compiled.** A distribution built for publication carries its compiled modules and declares them in the
 *   `exports` of its manifest. Node resolves them by itself: nothing is prepared, no other process runs, and
 *   the host is an ordinary Node process. This is the contract of a released Packages.
 * - **Bootstrap.** A distribution that carries sources needs them compiled and served before the host can
 *   import them. That preparation is not part of this service: it is provided by the separate, transitional
 *   `@beyond-js/packages-bootstrap` package, which runs Engine for that purpose and tells the service how to
 *   start the host against it.
 *
 * Either way the service receives a launch description and does the same things with it: start the host,
 * publish the discovery record, track attachments, end. The lifecycle of the service does not know Engine.
 *
 * ```js
 * const implementation = await Implementation.provider(installation);
 * const launch = await implementation.prepare({ directory, log });
 * // { execArgv, env, cwd, watchers: { env, cwd }, groups, versions }
 * await implementation.stop();
 * ```
 *
 * `groups` are the process groups the preparation started, recorded in the inventory of the service so that
 * whoever verifies a stopped service can check them.
 */
export class Implementation {
	static BOOTSTRAP = '@beyond-js/packages-bootstrap';

	/**
	 * @param {import('./installation.mjs').Installation} installation
	 * @returns {Promise<{prepare: Function, stop: Function}>}
	 */
	static async provider(installation) {
		if (installation.compiled) return new Compiled(installation);

		let bootstrap;
		try {
			bootstrap = await import(Implementation.BOOTSTRAP);
		} catch (error) {
			if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
			throw new Error(
				`This installation of @beyond-js/packages carries sources, not its compiled implementation, and ` +
					`${Implementation.BOOTSTRAP}, which prepares them, is not installed beside it`
			);
		}
		return new bootstrap.Bootstrap(installation.packages);
	}
}

/**
 * The implementation of a compiled distribution: already importable, so there is nothing to prepare
 */
class Compiled {
	#installation;

	constructor(installation) {
		this.#installation = installation;
	}

	async prepare() {
		const { path } = this.#installation.packages;
		return { execArgv: [], env: {}, cwd: path, watchers: { env: {}, cwd: path }, groups: [], versions: {} };
	}

	async stop() {}
}
