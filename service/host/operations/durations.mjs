import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * How long each step of each kind of operation usually takes, measured on this workspace: the newest durations of
 * the steps that ended well, kept in `<root>/.beyond/operations/durations.json`. "Usually about" is their median and
 * "taking longer than usual" starts past their 90th percentile; below `MINIMUM` samples the written defaults of the
 * kind are used, and the expectation says which (`source: measured | default`), as the family's long-operation rule
 * asks.
 */
export class Durations {
	/**
	 * Samples needed before the measured figures replace the defaults
	 */
	static MINIMUM = 5;

	/**
	 * Samples kept per step
	 */
	static KEPT = 50;

	#file;
	#samples = {};
	#loaded;
	#writing = Promise.resolve();

	/**
	 * @param {string} directory The directory of the operation records
	 */
	constructor(directory) {
		this.#file = join(directory, 'durations.json');
	}

	async load() {
		return (this.#loaded ??= readFile(this.#file, 'utf8')
			.then(text => {
				const value = JSON.parse(text);
				if (value && typeof value === 'object' && !Array.isArray(value)) this.#samples = value;
			})
			.catch(() => void 0));
	}

	/**
	 * The expectation of a step: measured when enough samples exist, else the defaults given
	 *
	 * @param {string} kind
	 * @param {string} step
	 * @param {{median: number, p90?: number}} [defaults]
	 * @returns {{median: number, p90: number, source: 'measured' | 'default', samples: number} | undefined}
	 */
	expected(kind, step, defaults) {
		const samples = (this.#samples[`${kind}/${step}`] ?? []).filter(value => Number.isFinite(value));
		if (samples.length >= Durations.MINIMUM) {
			const sorted = [...samples].sort((a, b) => a - b);
			const at = share => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
			return { median: at(0.5), p90: at(0.9), source: 'measured', samples: samples.length };
		}
		if (!defaults) return;
		return { median: defaults.median, p90: defaults.p90 ?? defaults.median * 2, source: 'default', samples: samples.length };
	}

	/**
	 * Records the duration of a step that ended well
	 *
	 * @param {string} kind
	 * @param {string} step
	 * @param {number} milliseconds
	 */
	record(kind, step, milliseconds) {
		if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
		const key = `${kind}/${step}`;
		const list = (this.#samples[key] ??= []);
		list.push(Math.round(milliseconds));
		list.splice(0, Math.max(0, list.length - Durations.KEPT));
		this.#writing = this.#writing.then(() => this.#write()).catch(() => void 0);
	}

	async #write() {
		await mkdir(join(this.#file, '..'), { recursive: true });
		const temporary = `${this.#file}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temporary, `${JSON.stringify(this.#samples)}\n`);
		await rename(temporary, this.#file);
	}

	/**
	 * Waits for the writes in progress, for a test or a stop
	 */
	settled() {
		return this.#writing;
	}
}
