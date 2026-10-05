import { Sources } from '@beyond-js/packages/http/routes';
import { Execution } from '@beyond-js/packages/execution';
import { Declaration } from '../workspace/declaration.mjs';
import { Generation } from './generation.mjs';
import { Generations } from './generations.mjs';
import { Manifests } from './manifests.mjs';

/**
 * The workspace this service hosts, kept current with its manifests and with its installation.
 *
 * Routes and descriptions hold this object, not a Packages workspace, because the workspace is replaced when
 * a manifest changes: a package or a module that was declared after the service started exists from the
 * next request on, without restarting the service. Sources are different: Packages watches them, and an
 * edited source is rebuilt by the workspace that is already loaded. Reading a workspace is bounded, at the
 * start and at a reload (see `Generations`).
 *
 * Each generation is created from the declaration of the workspace (its members, wherever they are) and from
 * the projection of its installed graph (see `Generation`), so a change of the lock, of the projection or of a
 * member outside the root reloads it as a manifest of the root does.
 */
export class Hosted {
	/**
	 * How long a workspace is given to be read when the caller names no bound, in milliseconds
	 * (`BEYOND_WORKSPACE_TIMEOUT` names it for the service)
	 */
	static DEADLINE = 120000;

	#manifests;
	#generations;
	#started;
	#sources = new Sources(this);

	/**
	 * How many times the workspace was reloaded, which is part of what a client sees as its revision
	 */
	get reloads() {
		return this.#generations.reloads;
	}

	/**
	 * @param {{root: string, supplied?: {name: string, path: string}[], runtime?: object}} settings The settings
	 * of the host
	 * @param {(message: string) => void} [log]
	 * @param {{deadline?: number}} [options] How long a workspace is given to be read, at the start and at a
	 * reload (`BEYOND_WORKSPACE_TIMEOUT`)
	 */
	constructor(settings, log = () => void 0, { deadline = Hosted.DEADLINE } = {}) {
		const files = [Execution.LOCK, Execution.PATH];
		this.#manifests = new Manifests(settings.root, () => Declaration.read(settings.root), { files });
		this.#generations = new Generations(() => new Generation(settings), { deadline, log });
	}

	get #current() {
		return this.#generations.current;
	}

	get #delivery() {
		return this.#current.delivery;
	}

	/**
	 * The first read of the workspace, started on first use and shared: it resolves once the workspace is
	 * served, within the deadline
	 *
	 * @throws {Error} `WORKSPACE_NOT_READY` when it is not read in time
	 */
	get ready() {
		return (this.#started ??= this.#generations.start());
	}

	/**
	 * Reads the workspace, within the deadline
	 *
	 * @throws {Error} `WORKSPACE_NOT_READY` when it is not read in time
	 */
	start() {
		return this.ready;
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

	/**
	 * Reloads the workspace now, whatever its manifests say: an installation wrote the projection it is served
	 * through. A reload in progress does not stand for this one (see `Generations.reload`). The manifests as they
	 * are now become the reference, so the next request does not reload again.
	 *
	 * @throws {ContractError} `UNAVAILABLE` when the reload is not ready within the deadline
	 */
	async reload() {
		this.#manifests.update();
		await this.#generations.reload('the installation wrote the projection of the installed graph');
	}

	/**
	 * The declaration of the workspace the served generation was created from
	 */
	get declared() {
		return this.#current.declaration;
	}

	/**
	 * The projection of the installed graph the served generation was created from: `{state, diagnostics,
	 * execution?}`, the execution being what the workspace resolves through when it is ready, stale or incomplete
	 */
	get projection() {
		return this.#current.projection;
	}

	/**
	 * What the served generation is made of: its members, its execution and its supplied packages
	 */
	get composition() {
		return this.#current.composition;
	}

	/**
	 * The execution projection the served workspace resolves through, undefined when it is not installed. The
	 * routes of the service and its extensions receive this object as their delivery, and read it here.
	 */
	get execution() {
		return this.#delivery.execution;
	}

	/**
	 * Where every package of the served generation comes from
	 */
	provenance() {
		return this.#current.provenance();
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
