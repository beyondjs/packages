/**
 * A bound on a wait, read from the environment of the process that waits.
 *
 * Every wait of the service ends, and how long it lasts is deployment configuration: on a saturated host a
 * healthy service answers later than on a developer's machine. Each bound is a variable that holds a whole
 * number of milliseconds, with a default for when it is absent or empty.
 *
 * ```js
 * const start = new Deadline('BEYOND_START_TIMEOUT', 300000);
 * start.read(process.env); // 300000, or what the variable says
 * ```
 */
export class Deadline {
	#name;
	#fallback;

	/**
	 * The variable that configures this bound, which a report of an expired wait names
	 */
	get name() {
		return this.#name;
	}

	/**
	 * @param {string} name The environment variable
	 * @param {number} [fallback] The milliseconds without it; without a fallback, `read` returns undefined
	 */
	constructor(name, fallback) {
		this.#name = name;
		this.#fallback = fallback;
	}

	/**
	 * @param {Record<string, string | undefined>} [environment]
	 * @returns {number | undefined} Milliseconds
	 * @throws {Error} When the variable is set to something that is not a whole number of milliseconds
	 */
	read(environment = process.env) {
		const given = environment[this.#name];
		if (given === void 0 || given === '') return this.#fallback;
		if (!/^[1-9]\d*$/.test(given)) throw new Error(`${this.#name} must be a whole number of milliseconds`);
		return Number(given);
	}
}
