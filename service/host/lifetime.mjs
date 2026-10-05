import { Holds } from './holds.mjs';

/**
 * When a service ends on its own.
 *
 * - `owner`: a foreground session started it and owns it. It ends when that session detaches, whoever else
 *   is attached; they are told. A session that merely found the service running is never its owner.
 * - `attachments`: it was started to execute an application or to install the workspace. It lives while anything
 *   is attached, so an application of another terminal, or a session that attached meanwhile, keeps it alive after
 *   the first application exits, and it ends shortly after the last one detaches. Work that holds it (`Holds`),
 *   such as an installation whose command was interrupted, keeps it alive as an attachment does, within the bound
 *   of that work: interrupting a command stops its wait, not its installation, and the service ends shortly after
 *   the installation when nobody is attached.
 *
 * A service that nobody attaches to after it became ready ends as well: whoever started it is gone.
 */
export class Lifetime {
	static IDLE = 2000;
	static UNCLAIMED = 30000;

	#mode;
	#attachments;
	#holds;
	#end;
	#timer;

	/**
	 * @param {'owner' | 'attachments'} mode
	 * @param {import('./attachments.mjs').Attachments} attachments
	 * @param {(reason: string) => void} end Ends the service
	 * @param {Holds} [holds] The work that keeps an `attachments` service alive while it runs
	 */
	constructor(mode, attachments, end, holds = new Holds()) {
		this.#mode = mode;
		this.#attachments = attachments;
		this.#end = end;
		this.#holds = holds;
	}

	/**
	 * Whether anything keeps the service alive now
	 */
	get #claimed() {
		if (this.#mode === 'owner') return this.#attachments.owned;
		return this.#attachments.size > 0 || this.#holds.size > 0;
	}

	/**
	 * Starts deciding, once the service is ready to be attached to
	 */
	start() {
		this.#schedule(Lifetime.UNCLAIMED, 'nobody attached to the service');

		this.#attachments.observe(({ type, kind }) => {
			if (this.#mode === 'owner') {
				// Only its owner claims an owned service: a borrower attaching first does not keep it alive
				if (kind !== 'owner') return;
				clearTimeout(this.#timer);
				type === 'detached' && this.#end('the session that owns the service ended');
				return;
			}

			clearTimeout(this.#timer);
			type === 'detached' && !this.#claimed && this.#schedule(Lifetime.IDLE, 'the last client detached');
		});

		// The end of the work that held a service nobody is attached to is when its idle time starts
		this.#holds.observe(() => {
			if (this.#mode === 'owner' || this.#claimed) return;
			clearTimeout(this.#timer);
			this.#schedule(Lifetime.IDLE, 'the work that held the service ended, and nobody is attached');
		});
	}

	#schedule(delay, reason) {
		this.#timer = setTimeout(() => !this.#claimed && this.#end(reason), delay);
		this.#timer.unref();
	}
}
