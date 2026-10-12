/**
 * The progress of the running operations on the event stream: a change that is not important (a count, the item a step
 * works on) is announced as `operation.progress {operation}`, the summary of the operation, at most once per `CADENCE`
 * per operation. The development extension delivers it to the open subscribers without keeping it in its replayed log,
 * as `launch.output` (`Development.TRANSIENT`), so a step that counts thousands of items never pushes the source events
 * out of the log; a client that reconnects reads the operation (`GET /operations/:id`). Important changes are
 * `operation.changed`, which is kept, and an announcement pending when one is made is dropped: it carries the newer
 * summary.
 *
 * ```js
 * const progress = new Progress(events);
 * progress.tell(operation);     // announced now, or once the cadence allows, with the summary of that moment
 * progress.cancel(operation.id);
 * ```
 */
export class Progress {
	/**
	 * Milliseconds between two progress announcements of one operation
	 */
	static CADENCE = 250;

	#events;
	#timers = new Map();
	#last = new Map();

	/**
	 * @param {{emit(type: string, data: object): void} | undefined} events The events of the host
	 */
	constructor(events) {
		this.#events = events;
	}

	/**
	 * Announces the progress of an operation, now or once the cadence allows
	 *
	 * @param {import('./operation.mjs').Operation} operation
	 */
	tell(operation) {
		const { id } = operation;
		// The announcement already scheduled reads the summary when it is made
		if (this.#timers.has(id)) return;
		const wait = (this.#last.get(id) ?? -Infinity) + Progress.CADENCE - Date.now();
		if (wait <= 0) return this.#announce(operation);
		const timer = setTimeout(() => {
			this.#timers.delete(id);
			this.#announce(operation);
		}, wait);
		timer.unref?.();
		this.#timers.set(id, timer);
	}

	/**
	 * Drops the announcement pending for an operation: an important change announced its newer summary
	 *
	 * @param {string} id
	 */
	cancel(id) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
	}

	/**
	 * Forgets an operation that ended
	 *
	 * @param {string} id
	 */
	forget(id) {
		this.cancel(id);
		this.#last.delete(id);
	}

	#announce(operation) {
		this.#last.set(operation.id, Date.now());
		// One that ended meanwhile was announced as operation.changed
		operation.running && this.#events?.emit('operation.progress', { operation: operation.summary });
	}
}
