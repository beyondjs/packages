/**
 * Work that keeps a service alive while it runs, each piece within a bound: what a client asked for and may stop
 * waiting for, such as an installation whose command the user interrupted. The work still ends, and the service
 * ends only afterwards (see `Lifetime`). The bound is a safety net for work that never settles: past it, the work
 * no longer holds the service.
 *
 * ```js
 * const holds = new Holds();
 * holds.observe(() => holds.size === 0 && console.log('nothing holds the service'));
 * const report = await holds.run(() => installation.install(), 600000);
 * ```
 */
export class Holds {
	#active = new Set();
	#listeners = new Set();

	/**
	 * How many pieces of work hold the service now
	 */
	get size() {
		return this.#active.size;
	}

	/**
	 * Calls back whenever a piece of work stops holding the service: it ended, or its bound passed
	 *
	 * @param {() => void} listener
	 */
	observe(listener) {
		this.#listeners.add(listener);
	}

	/**
	 * Runs work that holds the service while it runs, at most `bound` milliseconds
	 *
	 * @param {() => Promise<T>} work
	 * @param {number} bound
	 * @returns {Promise<T>} What the work answers, or rejects with
	 * @template T
	 */
	async run(work, bound) {
		const hold = Symbol('hold');
		this.#active.add(hold);
		const timer = setTimeout(() => this.#release(hold), bound);
		timer.unref?.();
		try {
			return await work();
		} finally {
			clearTimeout(timer);
			this.#release(hold);
		}
	}

	#release(hold) {
		if (!this.#active.delete(hold)) return;
		this.#listeners.forEach(listener => listener());
	}
}
