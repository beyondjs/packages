/**
 * Turns to run something one at a time, in the order they were asked for, each waiting for its turn within a
 * bound. A request that does not get its turn in time gives up and never runs: its outcome is known.
 *
 * ```js
 * const turns = new Turns();
 * if (!(await turns.take(120000))) return 'not started';
 * try { await work(); } finally { turns.release(); }
 * ```
 */
export class Turns {
	#busy = false;
	#waiting = [];

	/**
	 * Whether a turn is held: something runs now
	 */
	get running() {
		return this.#busy;
	}

	/**
	 * How many requests wait for their turn
	 */
	get queued() {
		return this.#waiting.length;
	}

	/**
	 * Waits for the turn
	 *
	 * @param {number} bound Milliseconds to wait for the turns before this one to end
	 * @returns {Promise<boolean>} true with the turn, which `release()` gives back; false when the bound expired
	 * first, and then this request has no turn and never will
	 */
	take(bound) {
		if (!this.#busy) {
			this.#busy = true;
			return Promise.resolve(true);
		}

		return new Promise(resolve => {
			const given = () => {
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				this.#waiting.splice(this.#waiting.indexOf(given), 1);
				resolve(false);
			}, bound);
			this.#waiting.push(given);
		});
	}

	/**
	 * Gives the turn to the request that waited longest, or frees it
	 */
	release() {
		const next = this.#waiting.shift();
		if (next) return next();
		this.#busy = false;
	}
}
