import type { ICancelSignal, ILimitsInput, IOutcome } from './types';
import * as ts from 'typescript';

const DEFAULTS = { ms: 60000, files: 2000, diagnostics: 500 };

/**
 * Thrown from inside the compiler to stop it when the budget is exhausted. It is always caught by the check.
 */
export class Exhausted extends Error {}

/**
 * The bounds of one check: its duration, the files it may load and the cancellation of its caller.
 *
 * The compiler is synchronous, so the bounds are enforced where it calls back: when it asks the host for a
 * file, and through the cancellation token it polls while it checks. A check that runs in a killable
 * process is still bounded by itself this way.
 */
export class Budget {
	#started = performance.now();
	#limits: { ms: number; files: number; diagnostics: number };
	#signal?: ICancelSignal;
	#loaded = 0;

	constructor(limits?: ILimitsInput, signal?: ICancelSignal) {
		const positive = (value: unknown, fallback: number) =>
			typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : fallback;

		this.#limits = {
			ms: positive(limits?.ms, DEFAULTS.ms),
			files: positive(limits?.files, DEFAULTS.files),
			diagnostics: positive(limits?.diagnostics, DEFAULTS.diagnostics)
		};
		this.#signal = signal;
	}

	/**
	 * The milliseconds elapsed since the check started. It is never zero, so a caller can always account it.
	 */
	get elapsed(): number {
		return Math.max(performance.now() - this.#started, 0.001);
	}

	/**
	 * The files counted so far
	 */
	get loaded(): number {
		return this.#loaded;
	}

	/**
	 * How many diagnostics a result carries
	 */
	get diagnostics(): number {
		return this.#limits.diagnostics;
	}

	/**
	 * Why the check must stop, or undefined while it may continue
	 */
	get outcome(): IOutcome | undefined {
		const { ms, files } = this.#limits;

		if (this.#signal?.aborted) {
			return { code: 'DIAGNOSTICS_CANCELLED', message: 'The check was cancelled by its caller' };
		}
		if (this.#loaded > files) {
			const message = `The program loads more than ${files} files`;
			return { code: 'DIAGNOSTICS_LIMIT_EXCEEDED', limit: 'files', message };
		}
		if (performance.now() - this.#started > ms) {
			const message = `The check did not complete in ${ms} ms`;
			return { code: 'DIAGNOSTICS_LIMIT_EXCEEDED', limit: 'ms', message };
		}
	}

	/**
	 * Stops the compiler when the budget is exhausted
	 */
	verify(): void {
		if (this.outcome) throw new Exhausted();
	}

	/**
	 * Counts files against the budget
	 */
	count(files = 1): void {
		this.#loaded += files;
		this.verify();
	}

	/**
	 * The token the type checker polls, which stops it in the middle of a file
	 */
	get token(): ts.CancellationToken {
		return {
			isCancellationRequested: () => !!this.outcome,
			throwIfCancellationRequested: () => {
				if (this.outcome) throw new ts.OperationCanceledException();
			}
		};
	}

	/**
	 * Gives the event loop a turn, which is when a cancellation requested by the caller becomes visible
	 */
	async pause(): Promise<void> {
		await new Promise(resolve => setImmediate(resolve));
		this.verify();
	}
}
