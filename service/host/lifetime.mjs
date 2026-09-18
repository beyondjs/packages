/**
 * When a service ends on its own.
 *
 * - `owner`: a foreground session started it and owns it. It ends when that session detaches, whoever else
 *   is attached; they are told. A session that merely found the service running is never its owner.
 * - `attachments`: it was started to execute an application. It lives while anything is attached, so an
 *   application of another terminal, or a session that attached meanwhile, keeps it alive after the first
 *   application exits, and it ends shortly after the last one detaches.
 *
 * A service that nobody attaches to after it became ready ends as well: whoever started it is gone.
 */
export class Lifetime {
	static IDLE = 2000;
	static UNCLAIMED = 30000;

	#mode;
	#attachments;
	#end;
	#timer;

	/**
	 * @param {'owner' | 'attachments'} mode
	 * @param {import('./attachments.mjs').Attachments} attachments
	 * @param {(reason: string) => void} end Ends the service
	 */
	constructor(mode, attachments, end) {
		this.#mode = mode;
		this.#attachments = attachments;
		this.#end = end;
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
			type === 'detached' && this.#attachments.size === 0 && this.#schedule(Lifetime.IDLE, 'the last client detached');
		});
	}

	#schedule(delay, reason) {
		this.#timer = setTimeout(() => {
			const claimed = this.#mode === 'owner' ? this.#attachments.owned : this.#attachments.size > 0;
			!claimed && this.#end(reason);
		}, delay);
		this.#timer.unref();
	}
}
