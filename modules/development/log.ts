import { randomBytes } from 'crypto';
import { DevelopmentError } from './error';

export /*bundle*/ interface IDevelopmentEvent {
	cursor: string;
	type: string;
	[key: string]: unknown;
}

export /*bundle*/ type ResyncReason = 'EPOCH' | 'GAP' | 'OVERFLOW' | 'WATCHER';

type Listener = (event: IDevelopmentEvent) => void;

/**
 * The ordered event log of one service run. A cursor is `<epoch>:<seq>`; the epoch changes whenever the
 * server cannot vouch for continuity, and a subscriber that returns with a cursor either receives exactly
 * the later events or is told to resynchronize against a scanned tree.
 */
export /*bundle*/ class Log {
	#epoch = '';
	#sequence = 0;
	#events: IDevelopmentEvent[] = [];
	#retention: number;
	#listeners = new Set<Listener>();

	get cursor(): string {
		return `${this.#epoch}:${this.#sequence}`;
	}

	constructor(retention = 2000) {
		this.#retention = retention;
		this.#renew();
	}

	#renew() {
		this.#epoch = randomBytes(6).toString('hex');
		this.#sequence = 0;
		this.#events = [];
	}

	append(type: string, data: Record<string, unknown> = {}): IDevelopmentEvent {
		this.#sequence++;
		const event = { cursor: this.cursor, type, ...data };
		this.#events.push(event);
		if (this.#events.length > this.#retention) this.#events.shift();
		this.#listeners.forEach(listener => listener(event));
		return event;
	}

	/**
	 * Start a new epoch because continuity was lost, and tell every open subscriber to resynchronize
	 */
	reset(reason: ResyncReason) {
		this.#renew();
		const event = { cursor: this.cursor, type: 'resync', reason };
		this.#listeners.forEach(listener => listener(event));
	}

	sequence(cursor: string): number {
		const [, value] = /^[A-Za-z0-9]{6,32}:([0-9]+)$/.exec(cursor ?? '') ?? [];
		if (value === undefined) throw new DevelopmentError('CURSOR_INVALID', `Invalid cursor "${cursor}"`, 400);
		return Number(value);
	}

	/**
	 * @returns The events after a cursor, or the reason the subscriber must resynchronize
	 */
	since(cursor: string): { events?: IDevelopmentEvent[]; resync?: ResyncReason } {
		const sequence = this.sequence(cursor);
		if (cursor.split(':')[0] !== this.#epoch) return { resync: 'EPOCH' };
		if (sequence > this.#sequence) return { resync: 'GAP' };

		const oldest = this.#events.length ? this.sequence(this.#events[0].cursor) : this.#sequence + 1;
		if (sequence < oldest - 1) return { resync: 'GAP' };
		return { events: this.#events.filter(event => this.sequence(event.cursor) > sequence) };
	}

	/**
	 * @returns Whether a source file changed after a cursor of the current epoch
	 */
	changed(cursor: string): boolean {
		const { events, resync } = this.since(cursor);
		return !!resync || events.some(event => event.type.startsWith('file.'));
	}

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}
}
