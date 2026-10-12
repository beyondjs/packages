import { readFileSync } from 'node:fs';
import { Modules } from './modules.mjs';
import { Production } from './production.mjs';
import { ProductionRoutes } from './routes.mjs';

/**
 * Production work of the service (`beyond-production/1`): the preflight, archive, registry status and publication of
 * a package, and the complete web export of a frontend execution target, which the headless build (`beyond build`)
 * runs too. Work that takes long runs as operations of the host (`production.pack`, `production.status`,
 * `production.publish`, `production.export`). See [the production guide](../../../docs/production.md) and the suite's
 * `docs/products/packages/developer-journey.md`.
 *
 * It is enabled on a service that mounts the development extension (whose shared objects it uses: the catalog of
 * applications, the declarations, the preview) and that does not verify delegated grants: the routes of a guarded
 * service are authorized by the extension's guard, which has no capability for production work, so there the feature
 * mounts nothing and claims nothing. Its routes are mounted before the extension registers its objects, so whether
 * a request is served is decided when it arrives.
 */
export class Feature {
	static NAME = 'production';

	#context;
	#production;
	#routes;

	/**
	 * @param {object} context What the host gives every feature (see `Features`)
	 * @param {{modules?: Modules, publisher?: object, fetch?: typeof fetch}} [options] Stand-ins a test gives for
	 * Packages' modules, npm and the network
	 */
	constructor(context, { modules = new Modules(), publisher, fetch } = {}) {
		this.#context = context;
		const toolchain = { packages: Feature.#version(), node: process.versions.node };
		this.#production = new Production({ ...context, toolchain }, { modules, publisher, fetch });
		this.#routes = new ProductionRoutes(this.#production, () => this.enabled);
	}

	/**
	 * The version of Packages this service runs, which an export's manifest names
	 */
	static #version() {
		try {
			return JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
		} catch {
			return 'unknown';
		}
	}

	/**
	 * Whether the feature serves requests: the development extension is mounted and no delegated grant is verified
	 */
	get enabled() {
		const { services, environment = process.env } = this.#context;
		return !!services?.get('files') && !environment.BEYOND_AUTHORITY;
	}

	/**
	 * Puts right what an earlier run left: expired archives, an export interrupted between its moves
	 */
	async start() {
		await this.#production.start();
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#routes.setup(app);
	}

	get capabilities() {
		return this.enabled ? { production: 1 } : {};
	}
}
