/**
 * The output of one launched process: the last lines of its standard output and error, numbered in the order they
 * arrived, and the announcement of new ones at most four times a second.
 *
 * ```js
 * const output = new Output({ announce: () => events.emit('launch.output', ...), observe: text => readiness.check(text) });
 * output.write('stdout', chunk);
 * output.read(0);      // {lines: [{seq, stream, text, time}], next, dropped}
 * ```
 *
 * - **A ring.** The last `Output.LIMIT` lines are kept; a reader that asks after a line no longer kept is told how
 *   many it lost (`dropped`) and receives the oldest kept onwards.
 * - **Lines as a terminal shows them.** A line ends at `\n`; a carriage return rewrites the line, so only what follows
 *   the last one is kept; terminal control sequences and other control characters are removed, so a browser never
 *   receives them. A line longer than `Output.WIDTH` characters is cut there with an ellipsis, and the rest of it,
 *   until its end, is not kept.
 * - **What is observed.** Every line, and the incomplete line that waits for its end, is given to `observe`, which is
 *   how a readiness text written without a final newline is still noticed.
 * - **Announcements are transient.** `launch.output` reaches the open subscribers of the event stream and is never
 *   kept in its replayed log (`Development.TRANSIENT`), so a chatty process never pushes the source events out of it;
 *   a client that reconnects reads what it missed with `read(after)`, `GET /launches/:id/output?after=`.
 */
export class Output {
	/**
	 * The lines kept
	 */
	static LIMIT = 1000;

	/**
	 * The characters of a line
	 */
	static WIDTH = 2000;

	/**
	 * Milliseconds between two announcements
	 */
	static CADENCE = 250;

	static #CONTROL = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?|\u001b[@-Z\\-_]|[\u0000-\u0008\u000b-\u001f\u007f]/g;

	#lines = [];
	#last = 0;
	#pending = { stdout: '', stderr: '' };
	#cut = { stdout: false, stderr: false };
	#announce;
	#observe;
	#clock;
	#timer;
	#announced = -Infinity;

	/**
	 * @param {{announce?: () => void, observe?: (text: string) => void, clock?: {now(): number}}} [options] What is
	 * called when lines arrived (throttled), what sees every line and incomplete line, and the clock of the times
	 */
	constructor({ announce = () => void 0, observe = () => void 0, clock = Date } = {}) {
		this.#announce = announce;
		this.#observe = observe;
		this.#clock = clock;
	}

	/**
	 * The number of the last line, which a reader passes as `after` to read what follows
	 */
	get next() {
		return this.#last;
	}

	/**
	 * Adds what a stream wrote
	 *
	 * @param {'stdout' | 'stderr'} stream
	 * @param {string} chunk
	 */
	write(stream, chunk) {
		const parts = `${this.#pending[stream]}${chunk}`.split('\n');
		this.#pending[stream] = parts.pop();
		parts.forEach(part => this.#line(stream, part));
		this.#limit(stream);
		this.#pending[stream] && this.#observe(Output.#clean(this.#pending[stream]));
	}

	/**
	 * A stream ended: its incomplete line is a line
	 *
	 * @param {'stdout' | 'stderr'} stream
	 */
	end(stream) {
		const pending = this.#pending[stream];
		this.#pending[stream] = '';
		pending && this.#line(stream, pending);
		this.#cut[stream] = false;
	}

	/**
	 * The lines after a number
	 *
	 * @param {number} [after] The number of the last line the reader has
	 * @returns {{lines: {seq: number, stream: string, text: string, time: string}[], next: number, dropped: number}}
	 */
	read(after = 0) {
		const lines = this.#lines.filter(line => line.seq > after).map(line => ({ ...line }));
		const first = this.#lines[0]?.seq ?? this.#last + 1;
		const dropped = Math.max(0, first - 1 - after);
		return { lines, next: lines.at(-1)?.seq ?? Math.min(after, this.#last), dropped };
	}

	/**
	 * The text of the last lines, which say why a process ended
	 *
	 * @param {number} count
	 * @returns {string[]}
	 */
	tail(count) {
		return this.#lines.slice(-count).map(({ stream, text }) => (stream === 'stderr' ? `[stderr] ${text}` : text));
	}

	/**
	 * Announces what is not announced yet and stops announcing later
	 */
	close() {
		if (!this.#timer) return;
		clearTimeout(this.#timer);
		this.#flush();
	}

	/**
	 * A line that grew past the width without ending is cut, and the rest of it is not kept
	 */
	#limit(stream) {
		const pending = this.#pending[stream];
		if (this.#cut[stream]) {
			this.#pending[stream] = '';
			return;
		}
		if (pending.length <= Output.WIDTH) return;
		this.#pending[stream] = '';
		this.#line(stream, pending);
		this.#cut[stream] = true;
	}

	#line(stream, raw) {
		// The rest of a line that was cut ends here, and is not a line of its own
		if (this.#cut[stream]) {
			this.#cut[stream] = false;
			return;
		}
		let text = Output.#clean(raw);
		if (text.length > Output.WIDTH) text = `${text.slice(0, Output.WIDTH - 1)}…`;
		this.#lines.push({ seq: ++this.#last, stream, text, time: new Date(this.#clock.now()).toISOString() });
		this.#lines.length > Output.LIMIT && this.#lines.shift();
		this.#observe(text);
		this.#schedule();
	}

	/**
	 * What a terminal would show of a line: the text after its last carriage return, without control sequences
	 */
	static #clean(raw) {
		const shown = raw.split('\r').filter(part => part !== '').at(-1) ?? '';
		return shown.replace(Output.#CONTROL, '');
	}

	#schedule() {
		if (this.#timer) return;
		const wait = this.#announced + Output.CADENCE - this.#clock.now();
		if (wait <= 0) return this.#flush();
		this.#timer = setTimeout(() => this.#flush(), wait);
		this.#timer.unref?.();
	}

	#flush() {
		this.#timer = undefined;
		this.#announced = this.#clock.now();
		this.#announce();
	}
}
