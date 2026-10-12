import { randomBytes } from 'node:crypto';
import { Step } from './step.mjs';

/**
 * One long operation of the service (a dependency check, a plan, its application, a publication, an export, a
 * build), as the family's long-operation rule asks: it lives on the service, its record is durable, and the page that
 * shows it is a view of it. A request identifier (`key`) makes a repeated request the same operation, so a lost answer
 * never starts the work twice.
 *
 * | State | Meaning |
 * | --- | --- |
 * | `running` | The work runs |
 * | `succeeded` | It ended well; `result` holds what it established |
 * | `failed` | It ended with `error` |
 * | `cancelled` | A person cancelled it and the work stopped |
 * | `interrupted` | The service stopped while it ran: its effect is unknown (`outcome: unknown`) until its feature reconciles it |
 *
 * The work reports through the steps (`operation.step(id).begin()`, `.phase()`, `.count()`, `.current()`, `.stall()`,
 * `.done()`); every change is written to the record, important changes at once and counts at most four times a second,
 * and announced by the registry (`Operations`). The host that runs it (`owner`) is recorded beside it, and a feature
 * names it in what it keeps while the work runs, so that another host on the same root leaves that alone.
 */
export class Operation {
	/**
	 * Milliseconds between two writes of counts and current items
	 */
	static CADENCE = 250;

	#id;
	#kind;
	#key;
	#scope;
	#state = 'running';
	#outcome;
	#created;
	#ended;
	#result;
	#error;
	#steps;
	#cancellable;
	#controller = new AbortController();
	#clock;
	#persist;
	#timer;
	#durations;
	#owner;

	/**
	 * @param {{kind: string, key?: string, scope?: object, cancellable?: boolean, steps: {id: string, expected?:
	 * object}[]}} specs
	 * @param {{clock: {now(): number}, persist: (operation: Operation, important: boolean) => void, durations?:
	 * import('./durations.mjs').Durations, owner?: import('./owner.mjs').Owner}} context
	 */
	constructor({ kind, key, scope, cancellable = false, steps }, { clock, persist, durations, owner }) {
		this.#id = `op_${randomBytes(12).toString('hex')}`;
		this.#owner = owner;
		this.#kind = kind;
		this.#key = key;
		this.#scope = scope;
		this.#cancellable = cancellable;
		this.#clock = clock;
		this.#persist = persist;
		this.#durations = durations;
		this.#created = clock.now();
		const changed = (step, important) => this.#changed(step, important);
		this.#steps = steps.map(({ id, expected }) => new Step({ id, expected: durations?.expected(kind, id, expected) ?? expected }, { clock, changed }));
	}

	get id() {
		return this.#id;
	}

	get kind() {
		return this.#kind;
	}

	get key() {
		return this.#key;
	}

	get scope() {
		return this.#scope;
	}

	get state() {
		return this.#state;
	}

	get running() {
		return this.#state === 'running';
	}

	get result() {
		return this.#result;
	}

	/**
	 * The host that runs the operation
	 *
	 * @returns {import('./owner.mjs').Owner | undefined}
	 */
	get owner() {
		return this.#owner;
	}

	/**
	 * Aborted when a person cancels the operation: the work passes it to whatever it waits on
	 */
	get signal() {
		return this.#controller.signal;
	}

	get cancellable() {
		return this.#cancellable && this.running;
	}

	/**
	 * A step of the operation, by its identifier
	 *
	 * @param {string} id
	 * @returns {Step}
	 */
	step(id) {
		const step = this.#steps.find(one => one.id === id);
		if (!step) throw new Error(`The operation ${this.#kind} has no step "${id}"`);
		return step;
	}

	#changed(step, important) {
		if (step?.state === 'done' && step.duration !== undefined) this.#durations?.record(this.#kind, step.id, step.duration);
		this.#persist(this, important);
	}

	/**
	 * Ends the operation well, with what it established
	 *
	 * @param {object} [result]
	 */
	succeed(result) {
		if (!this.running) return;
		this.#state = 'succeeded';
		this.#result = result;
		this.#end();
	}

	/**
	 * Ends the operation with an error; a step in progress fails with it
	 *
	 * @param {{code?: string, message?: string, details?: object}} error
	 */
	fail(error) {
		if (!this.running) return;
		this.#state = 'failed';
		this.#error = { code: String(error?.code ?? 'OPERATION_FAILED'), message: String(error?.message ?? error), ...(error?.details ? { details: error.details } : {}) };
		this.#steps.filter(step => step.state === 'progress' || step.state === 'stalled').forEach(step => step.fail(this.#error));
		this.#end();
	}

	/**
	 * Asks the work to stop; the operation ends `cancelled` once the work answers with `cancelled()`
	 *
	 * @returns {boolean} Whether it was asked
	 */
	cancel() {
		if (!this.cancellable) return false;
		this.#controller.abort(Object.assign(new Error('The operation was cancelled'), { code: 'OPERATION_CANCELLED' }));
		return true;
	}

	/**
	 * The work stopped because it was cancelled
	 *
	 * @param {object} [result] What it had done, when anything remains
	 */
	cancelled(result) {
		if (!this.running) return;
		this.#state = 'cancelled';
		this.#result = result;
		this.#steps.filter(step => step.state === 'progress' || step.state === 'stalled').forEach(step => step.fail({ code: 'OPERATION_CANCELLED', message: 'Cancelled' }));
		this.#end();
	}

	#end() {
		this.#ended = this.#clock.now();
		this.#persist(this, true);
	}

	/**
	 * The record of the operation: what `GET /operations/:id` answers and what is written to disk
	 *
	 * @param {{result?: boolean}} [options] Whether the result is included (a listing leaves it out)
	 */
	toJSON({ result = true } = {}) {
		const time = value => (value === undefined ? void 0 : new Date(value).toISOString());
		return {
			protocol: 'beyond-dev-operations/1',
			id: this.#id,
			kind: this.#kind,
			...(this.#key ? { key: this.#key } : {}),
			...(this.#scope ? { scope: this.#scope } : {}),
			state: this.#state,
			...(this.#outcome ? { outcome: this.#outcome } : {}),
			created: time(this.#created),
			...(this.#ended !== undefined ? { ended: time(this.#ended) } : {}),
			cancellable: this.cancellable,
			steps: this.#steps.map(step => step.toJSON()),
			...(this.#error ? { error: this.#error } : {}),
			...(result && this.#result !== undefined ? { result: this.#result } : {})
		};
	}

	/**
	 * A summary for a listing and for the event that announces a change
	 */
	get summary() {
		return this.toJSON({ result: false });
	}

	/**
	 * Schedules a write: at once for an important change, else within the cadence
	 *
	 * @param {(record: object) => Promise<void>} write
	 * @param {boolean} important
	 */
	schedule(write, important) {
		if (important) {
			clearTimeout(this.#timer);
			this.#timer = void 0;
			return write(this.toJSON());
		}
		this.#timer ??= setTimeout(() => {
			this.#timer = void 0;
			void write(this.toJSON());
		}, Operation.CADENCE);
		this.#timer.unref?.();
	}
}
