import type { ILimits } from './types';

const MiB = 1024 * 1024;

/**
 * The bounds of a fetch, with their defaults. They are engineering defaults chosen to admit the largest
 * packages in common use while stopping an abusive archive early; the consumer overrides any of them.
 */
export /*bundle*/ class Limits implements Required<ILimits> {
	readonly compressed: number;
	readonly extracted: number;
	readonly entries: number;
	readonly timeout: number;
	readonly concurrency: number;

	constructor(values: ILimits = {}) {
		const positive = (value: number | undefined, fallback: number) =>
			typeof value === 'number' && value > 0 && Number.isFinite(value) ? Math.floor(value) : fallback;

		this.compressed = positive(values.compressed, 64 * MiB);
		this.extracted = positive(values.extracted, 256 * MiB);
		this.entries = positive(values.entries, 20_000);
		this.timeout = positive(values.timeout, 120_000);
		this.concurrency = positive(values.concurrency, 6);
	}
}
