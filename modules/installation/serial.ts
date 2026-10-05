/**
 * Runs tasks one at a time, in the order they were given: a task starts once the previous one settled,
 * whatever its outcome
 */
export class Serial {
	#last: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const run = this.#last.then(task);
		this.#last = run.catch((): void => void 0);
		return run;
	}
}
