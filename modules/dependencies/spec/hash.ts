import type { DependenciesSpec } from './';
import { equal } from '@beyond-js/equal/main';
import { createHash } from 'crypto';

export default class DependenciesHash {
	#spec: DependenciesSpec;

	#value: string;
	get value(): string {
		return this.#value;
	}

	constructor(spec: DependenciesSpec) {
		this.#spec = spec;
	}

	/**
	 * Generates a MD5 hash for the given dependencies specifications.
	 *
	 * @param spec The dependencies specifications to hash.
	 * @returns The MD5 hash as a string.
	 */
	update(): void {
		const compute: Record<string, { version: string; kind: string }> = {};
		this.#spec.forEach(({ version, kind }, key) => {
			compute[key] = { version, kind };
		});
		this.#value = createHash('md5').update(equal.generate(compute)).digest('hex');
	}
}
