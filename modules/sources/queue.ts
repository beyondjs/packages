/**
 * Runs tasks with a bounded number of them in flight
 */
export class Queue {
	#limit: number;
	#running = 0;
	#waiting: Array<() => void> = [];

	constructor(limit: number) {
		this.#limit = limit;
	}

	async run<T>(task: () => Promise<T>): Promise<T> {
		if (this.#running >= this.#limit) await new Promise<void>(resolve => this.#waiting.push(resolve));
		this.#running++;

		try {
			return await task();
		} finally {
			this.#running--;
			this.#waiting.shift()?.();
		}
	}
}
