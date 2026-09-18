/**
 * Runs tasks one after another. Everything that reads disk to update the index goes through one sequence, so
 * a watcher hint never observes the middle of an API mutation and announces it as an external change.
 */
export class Sequence {
	#tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.#tail.then(task, task);
		this.#tail = result.catch(() => undefined);
		return result;
	}
}
