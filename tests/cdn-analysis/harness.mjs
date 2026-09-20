/**
 * How a step of the CDN validations is run and reported. A failure does not interrupt the run, so one
 * execution reports every checked behavior.
 */
export class Report {
	#results = [];

	/**
	 * @param name What the step establishes
	 * @param check The assertions, which may return a short note of what was observed
	 */
	async step(name, check) {
		try {
			const notes = await check();
			this.#results.push(true);
			console.log(`PASS ${name}${notes ? ` — ${notes}` : ''}`);
		} catch (error) {
			this.#results.push(false);
			console.log(`FAIL ${name}\n${error.stack}`);
		}
	}

	/**
	 * A step that cannot run here is reported as skipped, never as passed, and is not counted
	 */
	skip(name, reason) {
		console.log(`SKIP ${name} — ${reason}`);
	}

	/**
	 * Prints the summary line and returns the exit code of the run
	 */
	close() {
		const passed = this.#results.filter(Boolean).length;
		console.log(`\n${passed}/${this.#results.length} passed`);
		return passed === this.#results.length ? 0 : 1;
	}
}
