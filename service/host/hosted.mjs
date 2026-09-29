import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Sources } from '@beyond-js/packages/http/routes';
import { Generations } from './generations.mjs';
import { Manifests } from './manifests.mjs';

/**
 * The workspace this service hosts, kept current with its manifests.
 *
 * Routes and descriptions hold this object, not a Packages workspace, because the workspace is replaced when
 * a manifest changes: a package or a module that was declared after the service started exists from the
 * next request on, without restarting the service. Sources are different: Packages watches them, and an
 * edited source is rebuilt by the workspace that is already loaded. Reading a workspace is bounded, at the
 * start and at a reload (see `Generations`).
 */
export class Hosted {
	#settings;
	#manifests;
	#generations;
	#sources = new Sources(this);

	/**
	 * How many times the workspace was reloaded, which is part of what a client sees as its revision
	 */
	get reloads() {
		return this.#generations.reloads;
	}

	/**
	 * @param {{root: string, standalone: boolean}} settings
	 * @param {(message: string) => void} log
	 * @param {{deadline: number}} options How long a workspace is given to be read, at the start and at a
	 * reload (`BEYOND_WORKSPACE_TIMEOUT`)
	 */
	constructor(settings, log, { deadline }) {
		this.#settings = settings;
		this.#manifests = new Manifests(settings.root);
		this.#generations = new Generations(() => this.#load(), { deadline, log });
	}

	#load() {
		const { root, standalone, supplied = [] } = this.#settings;
		const options = { watcher: true, packages: standalone ? ['.'] : undefined, supplied: supplied.map(({ path }) => path) };
		return new Loaded(new Workspace(root, options));
	}

	get #delivery() {
		return this.#generations.current.delivery;
	}

	/**
	 * Reads the workspace, within the deadline
	 *
	 * @throws {Error} `WORKSPACE_NOT_READY` when it is not read in time
	 */
	start() {
		return this.#generations.start();
	}

	/**
	 * Reloads the workspace when its manifests changed. It is called before resolving or describing, and
	 * answers `UNAVAILABLE` when the reload is not ready within the deadline; the previous workspace is
	 * served meanwhile, and the next call tries again.
	 */
	async refresh() {
		this.#manifests.changed && this.#generations.invalidate();
		await this.#generations.refresh();
	}

	// The members of a Delivery that the routes and the descriptions of this service use

	get selection() {
		return this.#delivery.selection;
	}

	diagnostics() {
		return this.#delivery.diagnostics();
	}

	published() {
		return this.#delivery.published();
	}

	module(request, conditions) {
		return this.#delivery.module(request, conditions);
	}

	declaration(request) {
		return this.#delivery.declaration(request);
	}

	get resources() {
		return this.#delivery.resources;
	}

	/**
	 * The installed packages this environment compiles for browsers
	 */
	get installed() {
		return this.#delivery.installed;
	}

	/**
	 * The registry id the compiled-module paths of this service write for a package at an exact version, or why
	 * it has none: the workspace and npm are unprefixed, and an installed package is addressed by the registry
	 * its lockfile recorded
	 *
	 * @returns {Promise<{registry?: string, reason?: string}>}
	 */
	origin(name, version) {
		return this.#sources.origin(name, version);
	}

	/**
	 * The registry id of the base address of a registry, such as the `publishConfig.registry` of a package
	 *
	 * @returns {Promise<string | undefined>}
	 */
	registry(base) {
		return this.#sources.origins.registry(base);
	}

	/**
	 * Whether an installed package at an exact version is delivered to browsers by this environment
	 */
	supplies(name, version) {
		return this.#delivery.supplies(name, version);
	}

	destroy() {
		this.#generations.destroy();
	}
}

/**
 * One generation of the hosted workspace: a Packages workspace and the delivery of its artifacts
 */
class Loaded {
	#workspace;
	#delivery;

	get delivery() {
		return this.#delivery;
	}

	get ready() {
		return this.#workspace.ready;
	}

	constructor(workspace) {
		this.#workspace = workspace;
		this.#delivery = new Delivery(workspace);
	}

	destroy() {
		this.#workspace.destroy();
	}
}
