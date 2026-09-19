/**
 * Counts how many times each source file of the fixture is evaluated, so a validation can tell an internal
 * module that was evaluated again from one that kept its state
 */
export function evaluated(file: string): void {
	const counters = ((<any>globalThis).evaluations ??= {});
	counters[file] = (counters[file] ?? 0) + 1;
}
