import { Failure } from './failure.mjs';
import { Launch } from './launch.mjs';
import { LaunchError } from './error.mjs';
import { Ports } from './ports.mjs';
import { Target } from './target.mjs';

/**
 * The launches of one service (`beyond-launches/1`): created from the declared execution targets, listed and stopped
 * by their identifiers, and ended with the service. Only launches this registry created exist for it: nothing else is
 * listed, read or stopped.
 *
 * ```js
 * const launches = new Launches({ catalog: () => services.get('applications'), command, events, bound: 10000 });
 * const { launch, created } = await launches.create({ application: 'composition', target: 'api' }, 'request-0001');
 * launches.stop(launch.id);
 * await launches.end();
 * ```
 *
 * - **One request, one launch.** A request identifier given again for the same target answers the launch it created,
 *   whatever its state, while the launch is kept; for another target it is refused (`IDEMPOTENCY_KEY_REUSED`). A request
 *   that was refused leaves its identifier free.
 * - **One launch of a target at a time.** A request while a launch of the target lives is refused with that launch
 *   (`LAUNCH_RUNNING`); requests for one target are decided one after the other, so two at once never start two
 *   processes.
 * - **Kept in memory.** Every live launch, and the last `Launches.RETAINED` ended ones with their output.
 * - **A taken port starts nothing.** When the port a target is given (`PORT` of its environment, or its declaration's
 *   `port`) already accepts connections just before the start, the launch fails at once with `PORT_IN_USE` and no
 *   process is started. `listeners()` says which declared targets' ports something listens on now.
 * - **Closed at the end.** `end()` closes the registry before it stops anything: a request decided afterwards, one whose
 *   target the catalog resolves only then included, is answered `UNAVAILABLE` (the service is ending) and starts no
 *   process, so nothing outlives the service.
 */
export class Launches {
	/**
	 * The ended launches kept, with their output and their request identifiers
	 */
	static RETAINED = 20;

	#catalog;
	#command;
	#events;
	#bound;
	#resolution;
	#settings;
	#ports;
	#launches = new Map();
	#requests = new Map();
	#turns = new Map();
	#closed = false;

	/**
	 * @param {{catalog: () => object | undefined, command: import('./command.mjs').Command, events?: {emit(type: string,
	 * data: object): void}, bound: number, resolution: number, settings?: () => ({value?: (key: string) => unknown} |
	 * undefined), ports?: Ports}} options How to reach the catalog of applications, how a target is run, where changes are
	 * announced, the milliseconds a stop waits before `SIGKILL`, the milliseconds the resolution of a target and the
	 * preparation of its command may take before the request is answered as unavailable, how to reach the settings (a
	 * target's `PORT`) and what tells whether a port is taken
	 */
	constructor({ catalog, command, events, bound, resolution, settings = () => void 0, ports = new Ports() }) {
		this.#settings = settings;
		this.#ports = ports;
		this.#catalog = catalog;
		this.#command = command;
		this.#events = events;
		this.#bound = bound;
		this.#resolution = resolution;
	}

	/**
	 * Every launch kept, the newest first
	 *
	 * @returns {object[]}
	 */
	list() {
		return [...this.#launches.values()].reverse().map(launch => launch.toJSON());
	}

	/**
	 * The declared backend targets whose port something listens on now: `{application, target, port, address, launch?}`,
	 * `launch` naming the live launch of this service that holds it. A target's port is the `PORT` of its variables in the
	 * settings, or the one its declaration names
	 *
	 * @returns {Promise<object[]>}
	 */
	async listeners() {
		const catalog = this.#catalog()?.catalog?.();
		const targets = (catalog?.applications ?? []).flatMap(application =>
			(application.targets ?? []).filter(target => target.kind === 'backend').map(target => ({ application: application.id, target: target.id, declared: target }))
		);
		const settings = this.#settings();
		const known = await Promise.all(
			targets.slice(0, 64).map(async ({ application, target, declared }) => {
				const variables = await settings?.value?.(`targets.${application}.${target}.environment`);
				return { application, target, port: Ports.of(variables, declared) };
			})
		);
		const found = await Promise.all(known.filter(({ port }) => port).map(async one => ({ ...one, listener: await this.#ports.listener(one.port) })));
		return found
			.filter(({ listener }) => listener)
			.map(({ application, target, port, listener }) => {
				const own = [...this.#launches.values()].find(launch => launch.live && launch.application === application && launch.target === target && launch.port === port);
				return { application, target, port, address: listener.address, ...(own ? { launch: own.id } : {}) };
			});
	}

	/**
	 * @param {string} id
	 * @returns {Launch}
	 * @throws {LaunchError} `LAUNCH_NOT_FOUND`
	 */
	get(id) {
		const launch = this.#launches.get(id);
		if (!launch) throw new LaunchError('LAUNCH_NOT_FOUND', `This development service has no launch "${id}"`);
		return launch;
	}

	/**
	 * Whether a process group of a launch this registry may still signal holds a process: a launch that lives, or one
	 * that was asked to stop
	 */
	get alive() {
		return [...this.#launches.values()].some(launch => launch.alive);
	}

	/**
	 * Launches a declared target, or answers the launch a request identifier already created
	 *
	 * @param {{application: string, target: string}} named
	 * @param {string} key The request identifier (`Idempotency-Key`)
	 * @param {string} [reached] The origin the request reached, for a host that gives no API origin
	 * @returns {Promise<{launch: Launch, created: boolean}>}
	 * @throws {LaunchError} `UNAVAILABLE` once the service is ending, `IDEMPOTENCY_KEY_REUSED`, `LAUNCH_RUNNING`, those
	 * of `Target.resolve` and `Command.of`
	 */
	async create({ application, target }, key, reached) {
		if (this.#closed) throw Launches.#ending();
		const name = `${application}/${target}`;
		for (let known = this.#requests.get(key); known; known = this.#requests.get(key)) {
			if (known.name !== name) {
				const message = `The request identifier "${key}" already named a launch of "${known.name}": a new request needs a new identifier`;
				throw new LaunchError('IDEMPOTENCY_KEY_REUSED', message, { application: known.name.split('/')[0], target: known.name.split('/')[1] });
			}
			const launch = await known.promise.catch(() => void 0);
			if (launch) return { launch, created: false };
			// The request that used it was refused: this one is decided again
			this.#requests.get(key) === known && this.#requests.delete(key);
		}

		const request = { name, promise: this.#turn(name, () => this.#start(application, target, reached)) };
		this.#requests.set(key, request);
		try {
			const launch = await request.promise;
			request.id = launch.id;
			return { launch, created: true };
		} catch (error) {
			this.#requests.get(key) === request && this.#requests.delete(key);
			throw error;
		}
	}

	/**
	 * Asks a launch to stop
	 *
	 * @param {string} id
	 * @returns {Launch}
	 * @throws {LaunchError} `LAUNCH_NOT_FOUND`, `LAUNCH_ENDED`
	 */
	stop(id) {
		const launch = this.get(id);
		if (!launch.stop(this.#bound)) {
			throw new LaunchError('LAUNCH_ENDED', `The launch "${id}" already ended (${launch.state})`, { launch: launch.toJSON() });
		}
		return launch;
	}

	/**
	 * Ends every launch that lives, as the service ends: the registry is closed first, so nothing is launched from then
	 * on, then `SIGTERM` to each group, `SIGKILL` to what remains once the grace passed, and the ends awaited within a
	 * bound of their own
	 *
	 * @param {{grace?: number, settle?: number}} [bounds] Milliseconds before `SIGKILL`, and after it
	 */
	async end({ grace = this.#bound, settle = 1000 } = {}) {
		this.#closed = true;
		const live = [...this.#launches.values()].filter(launch => launch.live);
		live.forEach(launch => launch.stop(grace));
		const ended = Promise.all(live.map(launch => launch.ended));
		await Launches.#race(ended, grace);
		live.forEach(launch => launch.kill());
		await Launches.#race(ended, settle);
	}

	/**
	 * Ends at once, with `SIGKILL`, every launch that lives: for a service whose process exits without time for a stop
	 */
	kill() {
		this.#closed = true;
		this.#launches.forEach(launch => launch.kill());
	}

	/**
	 * Settles once every launch this registry may still signal reached its final state
	 *
	 * @returns {Promise<void>}
	 */
	async settled() {
		await Promise.all([...this.#launches.values()].filter(launch => launch.alive).map(launch => launch.ended));
	}

	static #ending() {
		return new LaunchError('UNAVAILABLE', 'The development service is ending: nothing is launched');
	}

	/**
	 * What a promise settles with, or the value given once the milliseconds passed
	 */
	static #race(promise, milliseconds, expired) {
		let timer;
		const bound = new Promise(resolve => (timer = setTimeout(() => resolve(expired), milliseconds)));
		return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
	}

	/**
	 * Runs the decisions about one target one after the other
	 */
	#turn(name, work) {
		const previous = this.#turns.get(name) ?? Promise.resolve();
		const current = previous.then(work);
		const settled = current.catch(() => void 0);
		this.#turns.set(name, settled);
		void settled.then(() => this.#turns.get(name) === settled && this.#turns.delete(name));
		return current;
	}

	async #start(application, target, reached) {
		if (this.#closed) throw Launches.#ending();
		const running = [...this.#launches.values()].find(launch => launch.live && launch.application === application && launch.target === target);
		if (running) {
			const message = `"${application}/${target}" already runs (${running.id}): stop it before launching it again`;
			throw new LaunchError('LAUNCH_RUNNING', message, { launch: running.toJSON() });
		}

		// The catalog may wait for a reload of the workspace, which it bounds itself; this bound is longer, so the precise
		// failure is the one reported, and a catalog that never answers does not hold the target's later requests
		const prepared = (async () => {
			const resolved = await Target.resolve(this.#catalog(), application, target);
			return { resolved, command: await this.#command.of(resolved, reached) };
		})();
		const expired = Symbol('expired');
		const outcome = await Launches.#race(prepared, this.#resolution, expired);
		if (outcome === expired) {
			const message = `The catalog of applications did not resolve "${application}/${target}" within ${this.#resolution}ms; nothing was launched`;
			throw new LaunchError('UNAVAILABLE', message);
		}

		// The service may have begun to end while the target was resolved: nothing is started then. The check and the
		// start below run in one turn, so an end that begins after it finds the launch among the ones it stops
		if (this.#closed) throw Launches.#ending();

		const { resolved, command } = outcome;
		// A port something already listens on fails the launch before any process starts
		const port = Ports.of(command.env, resolved);
		const listener = port ? await this.#ports.listener(port) : void 0;
		if (this.#closed) throw Launches.#ending();

		const changed = launch => this.#events?.emit('launch.changed', { launch: launch.toJSON() });
		const announce = launch => this.#events?.emit('launch.output', { launch: launch.toJSON(), next: launch.output.next });
		const launch = new Launch(resolved, { changed, announce, diagnostics: command.diagnostics, port });
		this.#launches.set(launch.id, launch);
		listener ? launch.refuse(Failure.taken(port, listener.address)) : launch.start(command);
		this.#prune();
		return launch;
	}

	/**
	 * Forgets the oldest ended launches beyond the ones kept, and the request identifiers that named them
	 */
	#prune() {
		const ended = [...this.#launches.values()].filter(launch => !launch.live);
		for (const launch of ended.slice(0, Math.max(0, ended.length - Launches.RETAINED))) {
			this.#launches.delete(launch.id);
			this.#requests.forEach((request, key) => request.id === launch.id && this.#requests.delete(key));
		}
	}
}
