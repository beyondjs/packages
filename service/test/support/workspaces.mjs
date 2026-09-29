/**
 * Stand-ins for the generations of a hosted workspace: what `Generations` needs of one, a `ready` promise
 * and `destroy()`, with a readiness the test decides.
 *
 * - `ready`: ready at once.
 * - `stalled`: never ready, as a workspace whose read does not settle.
 * - `failing`: its readiness rejects with an error coded `READ_FAILED`.
 */
export class StandIn {
	#behavior;
	#ready;
	#destroyed = false;

	get behavior() {
		return this.#behavior;
	}

	get ready() {
		return this.#ready;
	}

	get destroyed() {
		return this.#destroyed;
	}

	/**
	 * @param {'ready' | 'stalled' | 'failing'} behavior
	 */
	constructor(behavior) {
		this.#behavior = behavior;
		if (behavior === 'ready') this.#ready = Promise.resolve();
		else if (behavior === 'stalled') this.#ready = new Promise(() => void 0);
		else this.#ready = Promise.reject(Object.assign(new Error('The manifests could not be read'), { code: 'READ_FAILED' }));

		// A rejection nobody has awaited yet is not an unhandled one
		this.#ready.catch(() => void 0);
	}

	destroy() {
		this.#destroyed = true;
	}
}

/**
 * Creates stand-ins in the order a test gives, and remembers each one it created
 */
export class Sequence {
	#behaviors;
	#created = [];

	get created() {
		return this.#created;
	}

	/**
	 * @param {Array<'ready' | 'stalled' | 'failing'>} behaviors
	 */
	constructor(behaviors) {
		this.#behaviors = [...behaviors];
	}

	/**
	 * The next stand-in; `ready` once the given behaviors are used
	 */
	create() {
		const generation = new StandIn(this.#behaviors.shift() ?? 'ready');
		this.#created.push(generation);
		return generation;
	}
}
