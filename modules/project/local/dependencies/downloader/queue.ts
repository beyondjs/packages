export class Queue {
	#limit: number;
	#run: number;
	#list: Array<() => void>;

	constructor(limit: number) {
		// Comments in English:
		// limit = max number of tasks that can run at the same time
		this.#limit = limit;
		this.#run = 0;
		this.#list = [];
	}

	take(): Promise<void> {
		// Comments in English:
		// Wait until there is room to run a new task
		return new Promise(ok => {
			const step = () => {
				if (this.#run < this.#limit) {
					this.#run++;
					ok();
					return;
				}
				this.#list.push(step);
			};
			step();
		});
	}

	leave(): void {
		// Comments in English:
		// Mark one task as done and wake the next waiter
		this.#run--;
		const next = this.#list.shift();
		if (next) next();
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		// Comments in English:
		// Convenience wrapper to run a task with take/leave
		await this.take();
		try {
			return await fn();
		} finally {
			this.leave();
		}
	}
}
