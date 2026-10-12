/**
 * One step of an operation, as the family's long-operation rule describes it: its state, when it began and ended,
 * how long it usually takes, the finer phase its source reports, counts of the items it works through, what it works
 * on now, and the reason it stalled or failed.
 *
 * | State | Meaning |
 * | --- | --- |
 * | `waiting` | Not begun |
 * | `progress` | Running |
 * | `stalled` | Finished its part or cannot move: something else blocks it, said in `reason` |
 * | `done` | Ended well |
 * | `failed` | Ended with `reason` |
 * | `skipped` | Not needed by this run (a frozen installation resolves nothing, for example) |
 *
 * A step never invents progress: counts, phases and what it works on come from the work itself, and a step that
 * reports none says only since when it runs. Every change calls `changed`, which the operation persists and announces.
 */
export class Step {
	static STATES = Object.freeze(['waiting', 'progress', 'stalled', 'done', 'failed', 'skipped']);

	#id;
	#state = 'waiting';
	#since;
	#until;
	#expected;
	#phase;
	#counts;
	#current;
	#reason;
	#clock;
	#changed;

	/**
	 * @param {{id: string, expected?: {median: number, p90?: number, source: string, samples?: number}}} specs
	 * @param {{clock: {now(): number}, changed: (step: Step, important: boolean) => void}} context
	 */
	constructor({ id, expected }, { clock, changed }) {
		if (typeof id !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(id)) throw new Error(`Invalid step identifier "${id}"`);
		this.#id = id;
		this.#expected = expected;
		this.#clock = clock;
		this.#changed = changed;
	}

	get id() {
		return this.#id;
	}

	get state() {
		return this.#state;
	}

	/**
	 * How long the step ran, in milliseconds, once it ended
	 */
	get duration() {
		return this.#since !== undefined && this.#until !== undefined ? this.#until - this.#since : void 0;
	}

	get ended() {
		return ['done', 'failed', 'skipped'].includes(this.#state);
	}

	#now() {
		return this.#clock.now();
	}

	#change(important = true) {
		this.#changed(this, important);
	}

	/**
	 * Starts the step; a phase can be given at once
	 *
	 * @param {{phase?: string}} [options]
	 */
	begin({ phase } = {}) {
		if (this.ended) return this;
		this.#state = 'progress';
		this.#since ??= this.#now();
		this.#reason = void 0;
		this.#phase = phase ? { label: phase, since: this.#now() } : this.#phase;
		this.#change();
		return this;
	}

	/**
	 * The finer progress the work reports: `resolution`, `download`, `materialization`, `analysis`, `preparation`
	 *
	 * @param {string} label
	 */
	phase(label) {
		if (this.ended) return this;
		this.#state === 'waiting' && this.begin();
		// The same phase told again changes no state: it is written and announced as progress
		const changed = this.#phase?.label !== label;
		if (changed) this.#phase = { label, since: this.#now() };
		this.#change(changed);
		return this;
	}

	/**
	 * Items done out of a total the work knows, with what they are (`packages`, `nodes`, `files`, `outputs`)
	 *
	 * @param {number} done
	 * @param {number} [total]
	 * @param {string} [unit]
	 */
	count(done, total, unit) {
		if (this.ended) return this;
		this.#counts = { done, ...(Number.isFinite(total) ? { total } : {}), ...(unit ? { unit } : {}) };
		this.#change(false);
		return this;
	}

	/**
	 * What the step works on now, such as a package and its version or a node of the graph
	 *
	 * @param {string | undefined} text
	 */
	current(text) {
		if (this.ended) return this;
		this.#current = text ? String(text).slice(0, 300) : void 0;
		this.#change(false);
		return this;
	}

	/**
	 * Something else blocks the step: what, and whether the service keeps trying
	 *
	 * @param {{code: string, message: string, retrying?: boolean, details?: object}} reason
	 */
	stall(reason) {
		if (this.ended) return this;
		this.#since ??= this.#now();
		this.#state = 'stalled';
		this.#reason = Step.#described(reason);
		this.#change();
		return this;
	}

	done() {
		if (this.ended) return this;
		this.#since ??= this.#now();
		this.#until = this.#now();
		this.#state = 'done';
		this.#current = void 0;
		this.#change();
		return this;
	}

	skip() {
		if (this.ended) return this;
		this.#state = 'skipped';
		this.#change();
		return this;
	}

	/**
	 * @param {{code: string, message: string, details?: object}} reason
	 */
	fail(reason) {
		if (this.ended) return this;
		this.#since ??= this.#now();
		this.#until = this.#now();
		this.#state = 'failed';
		this.#reason = Step.#described(reason);
		this.#change();
		return this;
	}

	static #described({ code, message, retrying, details } = {}) {
		return { code: String(code ?? 'STEP_FAILED'), message: String(message ?? ''), ...(retrying !== undefined ? { retrying: !!retrying } : {}), ...(details ? { details } : {}) };
	}

	/**
	 * The step as a record carries it; times are ISO strings
	 */
	toJSON() {
		const time = value => (value === undefined ? void 0 : new Date(value).toISOString());
		const phase = this.#phase ? { label: this.#phase.label, since: time(this.#phase.since) } : void 0;
		return {
			id: this.#id,
			state: this.#state,
			...(this.#since !== undefined ? { since: time(this.#since) } : {}),
			...(this.#until !== undefined ? { until: time(this.#until) } : {}),
			...(this.#expected ? { expected: this.#expected } : {}),
			...(phase && !this.ended ? { phase } : {}),
			...(this.#counts ? { counts: this.#counts } : {}),
			...(this.#current ? { current: this.#current } : {}),
			...(this.#reason ? { reason: this.#reason } : {})
		};
	}

	/**
	 * A step as a record read again after the service restarted: its last known state, never resumed
	 */
	static restore(record) {
		return { ...record };
	}
}
