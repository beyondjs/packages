/**
 * The bound of one installation: `BEYOND_INSTALL_DEADLINE` milliseconds (540000 by default, below the command line's
 * bound on the service), or the `deadline` its parameters give. When it passes, every request still running is
 * aborted and no other one starts, and the installation answers `INSTALLATION_TIMEOUT` having written nothing.
 *
 * Writing starts only through `commit`, which a deadline that already passed refuses; once writing started, the
 * deadline no longer interrupts it, so the answer always says what is on disk.
 */
export class Deadline {
	static DEFAULT = 540_000;

	#milliseconds: number;
	#controller = new AbortController();
	#timer: ReturnType<typeof setTimeout>;
	#state: 'running' | 'expired' | 'committed' = 'running';
	#reached: Promise<void>;

	/**
	 * The bound, in milliseconds
	 */
	get milliseconds() {
		return this.#milliseconds;
	}

	/**
	 * Aborted when the deadline passes
	 */
	get signal(): AbortSignal {
		return this.#controller.signal;
	}

	get expired(): boolean {
		return this.#state === 'expired';
	}

	/**
	 * Resolves when the deadline passes; never, once writing started or the installation ended
	 */
	get reached(): Promise<void> {
		return this.#reached;
	}

	/**
	 * @param milliseconds The bound; `BEYOND_INSTALL_DEADLINE`, else 540000, when it is not a positive number
	 */
	constructor(milliseconds?: number) {
		const given = Number(milliseconds ?? process.env.BEYOND_INSTALL_DEADLINE);
		this.#milliseconds = Number.isFinite(given) && given > 0 ? given : Deadline.DEFAULT;
		this.#reached = new Promise(resolve => {
			this.#timer = setTimeout(() => {
				if (this.#state !== 'running') return;
				this.#state = 'expired';
				this.#controller.abort();
				resolve();
			}, this.#milliseconds);
		});
	}

	/**
	 * Starts writing: false when the deadline already passed, and then nothing may be written
	 */
	commit(): boolean {
		if (this.#state === 'expired') return false;
		this.clear();
		return true;
	}

	/**
	 * Ends the bound without it passing
	 */
	clear(): void {
		clearTimeout(this.#timer);
		if (this.#state === 'running') this.#state = 'committed';
	}
}
