import { Durations } from './durations.mjs';
import { Operation } from './operation.mjs';
import { OperationError } from './error.mjs';
import { Owner } from './owner.mjs';
import { Progress } from './progress.mjs';
import { Store } from './store.mjs';

/**
 * The long operations of one service: created by its features (dependency checks and plans, their application,
 * publication, export, build), kept as durable records and announced on the event stream: `operation.changed` for an
 * important change (a state, a step's state or phase, the end), kept in the event log, and `operation.progress` for
 * counts and current items, at most four times a second per operation and never kept (`Progress`).
 *
 * ```js
 * const operations = new Operations({ root, events, holds });
 * await operations.start();
 * const operation = operations.run(
 *   { kind: 'dependencies.check', key: request, scope, cancellable: true, steps: [{ id: 'metadata', expected: { median: 4000 } }] },
 *   async operation => { operation.step('metadata').begin(); ...; return result; }
 * );
 * ```
 *
 * - **One request, one operation.** A request identifier (`key`, the `Idempotency-Key` of the request that asked for
 *   it) given again for the same kind answers the operation it created, whatever its state, while its record is kept.
 * - **A restart is said.** Each record names its owner, the host that runs it (`Owner`). A record still `running` when
 *   the service starts whose owner is gone belonged to a service that stopped: it becomes `interrupted` with
 *   `outcome: unknown`, and its feature reconciles it by reading before anything is repeated. One whose owner lives is
 *   another host's on the same root (an exclusive `beyond build` beside a person's service), and is left as it is.
 * - **The work holds the service** while it runs, within its bound (`Holds`), so a client that stops waiting does not
 *   end the service under it.
 */
export class Operations {
	/**
	 * Milliseconds a record is kept after it was created (`BEYOND_OPERATIONS_RETENTION`)
	 */
	static RETENTION = 7 * 24 * 3600 * 1000;

	/**
	 * Milliseconds an operation may hold the service when its feature names no bound
	 */
	static BOUND = 15 * 60 * 1000;

	#store;
	#durations;
	#events;
	#holds;
	#clock;
	#retention;
	#owner;
	#progress;
	#live = new Map();
	#keys = new Map();
	#writes = new Map();
	#ending = new Map();

	/**
	 * @param {{root: string, events?: {emit(type: string, data: object): void}, holds?: {run<T>(work: () =>
	 * Promise<T>, bound: number): Promise<T>}, clock?: {now(): number}, retention?: number, owner?: Owner}} options The
	 * owner is this host by default
	 */
	constructor({ root, events, holds, clock = Date, retention = Operations.RETENTION, owner = new Owner() }) {
		this.#store = new Store(root);
		this.#durations = new Durations(this.#store.directory);
		this.#events = events;
		this.#holds = holds;
		this.#clock = clock;
		this.#retention = retention;
		this.#owner = owner;
		this.#progress = new Progress(events);
	}

	get durations() {
		return this.#durations;
	}

	/**
	 * The host that owns the operations this registry runs, which the features record beside what they keep
	 *
	 * @returns {Owner}
	 */
	get owner() {
		return this.#owner;
	}

	/**
	 * Reads the records left by an earlier run: removes the expired ones, marks `interrupted` the running ones whose
	 * owner is gone and indexes the request identifiers of the rest. What a live host on the same root runs is left as
	 * it is, and never removed.
	 */
	async start() {
		await this.#durations.load();
		const live = record => record.state === 'running' && !this.#owner.gone(record.owner);
		await this.#store.sweep(this.#retention, this.#clock.now(), live);
		for (const record of await this.#store.list()) {
			if (record.state === 'running' && !live(record)) {
				const steps = (record.steps ?? []).map(step =>
					step.state === 'progress' || step.state === 'stalled'
						? { ...step, state: 'failed', reason: { code: 'OPERATION_INTERRUPTED', message: 'The service stopped while this step ran' } }
						: step
				);
				const interrupted = {
					...record,
					state: 'interrupted',
					outcome: 'unknown',
					cancellable: false,
					ended: new Date(this.#clock.now()).toISOString(),
					steps,
					error: { code: 'OPERATION_INTERRUPTED', message: 'The service stopped while this operation ran: what it changed is read again before it is repeated' }
				};
				await this.#store.write(interrupted);
				record.state = 'interrupted';
			}
			record.key && this.#keys.set(`${record.kind}:${record.key}`, record.id);
		}
	}

	/**
	 * Creates an operation and runs its work in the background; a request identifier already used for this kind
	 * answers the operation it created instead
	 *
	 * @param {{kind: string, key?: string, scope?: object, cancellable?: boolean, bound?: number, steps: {id: string,
	 * expected?: {median: number, p90?: number}}[]}} specs
	 * @param {(operation: Operation) => Promise<object | void>} work What establishes the result; it reports through the
	 * steps and reads `operation.signal` to stop when cancelled
	 * @returns {Promise<{operation: object, created: boolean}>} The record, and whether this call created it
	 */
	async run(specs, work) {
		Operations.#check(specs.kind);
		const known = specs.key ? this.#keys.get(`${specs.kind}:${specs.key}`) : void 0;
		if (known) {
			const record = await this.get(known).catch(() => void 0);
			if (record) return { operation: record, created: false };
		}

		const operation = new Operation(specs, {
			clock: this.#clock,
			durations: this.#durations,
			owner: this.#owner,
			persist: (one, important) => this.#persist(one, important)
		});
		this.#live.set(operation.id, operation);
		specs.key && this.#keys.set(`${specs.kind}:${specs.key}`, operation.id);
		await this.#write(operation.toJSON());
		this.#announce(operation);

		const bound = specs.bound ?? Operations.BOUND;
		const execute = async () => {
			try {
				const result = await work(operation);
				operation.signal.aborted ? operation.cancelled(result ?? void 0) : operation.succeed(result ?? void 0);
			} catch (error) {
				operation.signal.aborted ? operation.cancelled() : operation.fail(error);
			}
		};
		const held = this.#holds ? this.#holds.run(execute, bound) : execute();
		const ending = held.catch(() => void 0).then(() => this.#settle(operation));
		this.#ending.set(operation.id, ending);
		void ending.finally(() => this.#ending.delete(operation.id));
		return { operation: operation.toJSON(), created: true };
	}

	/**
	 * An operation's record: the live one while it runs, else the one written
	 *
	 * @param {string} id
	 * @throws {OperationError} `OPERATION_NOT_FOUND`
	 */
	async get(id) {
		const live = this.#live.get(id);
		if (live) return live.toJSON();
		const record = await this.#store.read(id);
		if (!record) throw new OperationError('OPERATION_NOT_FOUND', `There is no operation "${id}"`);
		return Operations.#answered(record);
	}

	/**
	 * The operations, newest first, without their results
	 *
	 * @param {{kind?: string, limit?: number}} [filter]
	 */
	async list({ kind, limit = 50 } = {}) {
		const records = await this.#store.list();
		const live = new Map([...this.#live.values()].map(operation => [operation.id, operation.summary]));
		const merged = records.map(record => live.get(record.id) ?? Operations.#summary(record));
		return merged.filter(record => !kind || record.kind === kind || record.kind.startsWith(`${kind}.`)).slice(0, limit);
	}

	/**
	 * Asks a running operation to stop
	 *
	 * @param {string} id
	 * @throws {OperationError} `OPERATION_NOT_FOUND`, `OPERATION_ENDED`, `OPERATION_NOT_CANCELLABLE`
	 */
	async cancel(id) {
		const live = this.#live.get(id);
		// An operation that ended is no longer cancellable, whether or not its last record is written yet
		if (!live?.running) {
			const record = live?.toJSON() ?? (await this.get(id));
			throw new OperationError('OPERATION_ENDED', `The operation "${id}" already ended (${record.state})`, { state: record.state });
		}
		if (!live.cancel()) throw new OperationError('OPERATION_NOT_CANCELLABLE', `The operation "${id}" cannot be cancelled`);
		return live.toJSON();
	}

	/**
	 * Waits for the writes in progress, so what is on disk is what was last reported
	 */
	async settled() {
		while (this.#writes.size) {
			await Promise.all([...this.#writes.values()]);
			await new Promise(resolve => setImmediate(resolve));
		}
		await this.#durations.settled();
	}

	/**
	 * Waits for the operations that run to end, then for their writes: for a test or a stop
	 */
	async idle() {
		while (this.#ending.size) await Promise.all([...this.#ending.values()]);
		await this.settled();
	}

	static #check(kind) {
		if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(kind)) {
			throw new OperationError('OPERATION_KIND_INVALID', `Invalid operation kind "${kind}"`);
		}
	}

	static #summary(record) {
		const { result, ...summary } = Operations.#answered(record);
		return summary;
	}

	/**
	 * A stored record as the routes answer it: its owner is bookkeeping of the hosts, no part of the protocol
	 */
	static #answered(record) {
		const { owner, ...answered } = record;
		return answered;
	}

	/**
	 * Writes a change, and announces it: an important one, and the end, as `operation.changed`, which the event log
	 * keeps; a count or a current item as `operation.progress`, at most once per cadence, which it does not
	 */
	#persist(operation, important) {
		operation.schedule(record => this.#write(record), important);
		if (!important && operation.running) return this.#progress.tell(operation);
		this.#progress.cancel(operation.id);
		this.#announce(operation);
	}

	#announce(operation) {
		this.#events?.emit('operation.changed', { operation: operation.summary });
	}

	/**
	 * Writes a record after the write before it, so the newest state is the last one written; the record names its owner
	 */
	#write(record) {
		const previous = this.#writes.get(record.id) ?? Promise.resolve();
		const owned = { ...record, owner: this.#owner.toJSON() };
		const next = previous.then(() => this.#store.write(owned)).catch(() => void 0);
		this.#writes.set(record.id, next);
		void next.then(() => this.#writes.get(record.id) === next && this.#writes.delete(record.id));
		return next;
	}

	async #settle(operation) {
		this.#progress.forget(operation.id);
		await this.#write(operation.toJSON());
		this.#live.delete(operation.id);
	}
}
