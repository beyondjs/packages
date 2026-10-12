import { Deadline } from '../deadline.mjs';

/**
 * Follows the declarations of the hosted workspace for the clients of the service: when the File API of the
 * development extension announces a change of a manifest (`package.json`, `module.json`, `beyond.json`) or of the
 * lock (`beyond-lock.json`), from the interface, an editor, an agent or Git, the hosted workspace is refreshed (its
 * existing generations, bounded by `BEYOND_WORKSPACE_TIMEOUT`) and, once a reload served the new declarations,
 * `workspace.changed {reloads}` is announced on the event stream, so a client reads the session and the state again
 * instead of polling.
 *
 * ```js
 * const reloads = new Reloads({ workspace, events, log, deadline });   // deadline: the one the hosted workspace has
 * reloads.start(services.get('log'));   // the event log of the development extension, after its setup
 * ```
 *
 * The refresh is the one every request that resolves or describes the workspace makes: a reload that another request
 * started is shared, a reload that fails or is not ready within its bound is served by the previous generation and
 * tried again by the next change or request, and unchanged declarations reload nothing. A reload made for another
 * reason (an installation, a request) is announced with the next refresh that observes it. Without the development
 * extension there is no event log to follow, and nothing is followed.
 */
export class Reloads {
	/**
	 * The names of the files whose change can change what the workspace declares
	 */
	static NAMES = Object.freeze(new Set(['package.json', 'module.json', 'beyond.json', 'beyond-lock.json']));

	/**
	 * How much longer than the reload of the workspace a refresh is waited for, in milliseconds: the reload is bounded
	 * by the workspace's own deadline, and this bound only keeps a refresh that never settles from holding the next one
	 */
	static MARGIN = 5000;

	#workspace;
	#events;
	#log;
	#bound;
	#announced;
	#running;
	#wanted = false;
	#unsubscribe;

	/**
	 * Milliseconds a refresh is waited for
	 */
	get bound() {
		return this.#bound;
	}

	/**
	 * How many reloads were announced: the count the last `workspace.changed` carried
	 */
	get announced() {
		return this.#announced;
	}

	/**
	 * @param {object} specs
	 * @param {{refresh: () => Promise<void>, reloads: number}} specs.workspace The hosted workspace
	 * @param {{emit: (type: string, data: Record<string, unknown>) => void}} specs.events The events of the host
	 * @param {(message: string) => void} [specs.log]
	 * @param {number} [specs.deadline] Milliseconds a reload of the workspace is given, as the host bounds it; read from
	 * `BEYOND_WORKSPACE_TIMEOUT` of the environment without it
	 * @param {number} [specs.bound] Milliseconds a refresh is waited for; the deadline and `Reloads.MARGIN` without it
	 * @param {Record<string, string | undefined>} [specs.environment]
	 */
	constructor({ workspace, events, log = () => void 0, deadline, bound, environment = process.env }) {
		this.#workspace = workspace;
		this.#events = events;
		this.#log = log;
		this.#bound = bound ?? (deadline ?? new Deadline('BEYOND_WORKSPACE_TIMEOUT', 120000).read(environment)) + Reloads.MARGIN;
		this.#announced = workspace.reloads;
	}

	/**
	 * Follows an event log
	 *
	 * @param {{subscribe: (listener: (event: {type: string, path?: string, from?: string}) => void) => () => void} | undefined} source
	 * The event log of the development extension, when it is mounted
	 * @returns {Reloads}
	 */
	start(source) {
		this.#unsubscribe = source?.subscribe(event => this.#observe(event));
		return this;
	}

	/**
	 * Whether an event can change the declarations: a file event of a manifest or of the lock, or a `resync`, after
	 * which a change may have gone unannounced
	 */
	static concerns({ type, path, from }) {
		if (type === 'resync') return true;
		if (!/^file\.(created|changed|deleted|renamed)$/.test(type)) return false;
		return [path, from].some(one => typeof one === 'string' && Reloads.NAMES.has(one.split('/').pop()));
	}

	#observe(event) {
		Reloads.concerns(event) && void this.refresh();
	}

	/**
	 * Refreshes the hosted workspace, once at a time: a change observed meanwhile is refreshed after it, because the
	 * refresh in progress may have read the files before it
	 *
	 * @returns {Promise<void>} Settles when the refresh asked for (or the one after it) ended; it never rejects
	 */
	refresh() {
		if (this.#running) {
			this.#wanted = true;
			return this.#running;
		}
		this.#running = this.#refresh().finally(() => {
			this.#running = void 0;
			if (!this.#wanted) return;
			this.#wanted = false;
			return this.refresh();
		});
		return this.#running;
	}

	async #refresh() {
		// A refresh that rejects after its bound passed is settled here, never left unhandled
		const refreshed = Promise.resolve()
			.then(() => this.#workspace.refresh())
			.then(() => ({}), error => ({ error }));
		let timer;
		const expired = new Promise(resolve => (timer = setTimeout(() => resolve({ expired: true }), this.#bound)));

		const outcome = await Promise.race([refreshed, expired]);
		clearTimeout(timer);
		// Served by the previous generation meanwhile; the next change or request tries again
		outcome.expired && this.#log(`declarations: the refresh of the workspace did not end within ${this.#bound}ms`);
		outcome.error && this.#log(`declarations: the workspace was not reloaded: ${outcome.error?.message ?? outcome.error}`);

		const reloads = this.#workspace.reloads;
		if (!(reloads > this.#announced)) return;
		this.#announced = reloads;
		this.#events.emit('workspace.changed', { reloads });
	}

	/**
	 * Stops following the event log; a refresh in progress ends by itself
	 */
	stop() {
		this.#unsubscribe?.();
		this.#unsubscribe = void 0;
	}
}
