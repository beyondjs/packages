/**
 * The service's log as its clients read it (`GET /logs`): the last `Journal.LIMIT` entries in memory, each with a
 * cursor that only grows, so a reader asks for what followed the last one it read.
 *
 * An entry is `{cursor, at, level, source, message}`: `level` is `info`, `warn` or `error`; `source` is `service` (the
 * host's own lines), `build` (the end of a build), `launch:<id>` (a launch that started or ended) or `tests` (a test run).
 * A message is one line, at most `Journal.WIDTH` characters, without control characters.
 *
 * ```js
 * const journal = new Journal();
 * journal.add('warn', 'service', 'the workspace was not reloaded');
 * journal.read({ after: 0, limit: 100 });   // {entries, cursor}
 * ```
 */
export class Journal {
	static LIMIT = 2000;
	static WIDTH = 4000;
	static LEVELS = Object.freeze(['info', 'warn', 'error']);

	static #CONTROL = /\u001b\[[0-?]*[ -/]*[@-~]|[\u0000-\u0008\u000b-\u001f\u007f]/g;

	#entries = [];
	#cursor = 0;
	#clock;

	/**
	 * @param {{clock?: () => number}} [options] The time in milliseconds (tests give their own)
	 */
	constructor({ clock = Date.now } = {}) {
		this.#clock = clock;
	}

	/**
	 * The cursor of the last entry, 0 before any
	 */
	get cursor() {
		return this.#cursor;
	}

	/**
	 * Adds an entry; the oldest one beyond the limit is forgotten
	 *
	 * @param {'info' | 'warn' | 'error'} level
	 * @param {string} source
	 * @param {unknown} message
	 */
	add(level, source, message) {
		const text = String(message ?? '').replace(Journal.#CONTROL, '').replace(/[\r\n]+/g, ' ').trim();
		const line = text.length > Journal.WIDTH ? `${text.slice(0, Journal.WIDTH - 1)}…` : text;
		const entry = { cursor: ++this.#cursor, at: new Date(this.#clock()).toISOString(), level: Journal.LEVELS.includes(level) ? level : 'info', source, message: line };
		this.#entries.push(entry);
		if (this.#entries.length > Journal.LIMIT) this.#entries.shift();
		return entry;
	}

	/**
	 * The entries after a cursor, the oldest first
	 *
	 * @param {{after?: number, limit?: number}} [range]
	 * @returns {{entries: object[], cursor: number}} `cursor` is the one of the last entry returned, or the one asked for
	 * when there is none after it
	 */
	read({ after = 0, limit = 500 } = {}) {
		const entries = this.#entries.filter(entry => entry.cursor > after).slice(0, limit).map(entry => ({ ...entry }));
		return { entries, cursor: entries.length ? entries.at(-1).cursor : Math.min(after, this.#cursor) };
	}
}
