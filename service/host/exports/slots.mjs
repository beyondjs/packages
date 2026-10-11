/**
 * How many uploads run at once in a service, whatever export they belong to: work waits for a free slot, in the
 * order it asked for one.
 *
 * ```js
 * const slots = new Slots(2);
 * await slots.run(() => upload.send());
 * ```
 */
export class Slots {
	#free;
	#waiting = [];

	/**
	 * @param {number} count
	 */
	constructor(count = 2) {
		this.#free = count;
	}

	/**
	 * Runs work once a slot is free, and frees it when the work ends
	 *
	 * @param {() => Promise<T>} work
	 * @returns {Promise<T>}
	 * @template T
	 */
	async run(work) {
		if (this.#free > 0) this.#free--;
		else await new Promise(resolve => this.#waiting.push(resolve));
		try {
			return await work();
		} finally {
			const next = this.#waiting.shift();
			next ? next() : this.#free++;
		}
	}
}
