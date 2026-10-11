/**
 * Events of the host that a client follows on the event stream of the development extension (`GET /events`), such
 * as `export.changed`. The host emits them; an extension that serves an event stream subscribes through the
 * `events` of its context and appends them to its log, ordered with its own events. Without such an extension the
 * events reach nobody, and a client reads the state they announce from its route.
 *
 * ```js
 * const events = new Events();
 * const unsubscribe = events.subscribe((type, data) => log.append(type, data));
 * events.emit('export.changed', { export: { id, state } });
 * ```
 */
export class Events {
	#listeners = new Set();

	/**
	 * @param {(type: string, data: Record<string, unknown>) => void} listener
	 * @returns {() => void} Stops the subscription
	 */
	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * @param {string} type
	 * @param {Record<string, unknown>} data
	 */
	emit(type, data) {
		for (const listener of this.#listeners) {
			try {
				listener(type, data);
			} catch {
				// A subscriber that fails does not stop the others, nor the work that announced the event
			}
		}
	}
}
