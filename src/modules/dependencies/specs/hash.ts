import type { DependenciesSpecs } from './';
import { crc32 } from '@beyond-js/crc32/main';
import { equal } from '@beyond-js/equal/main';

export default class DependenciesHash {
	#specs: DependenciesSpecs;

	#value: number | undefined;
	get value(): number {
		return this.#value;
	}

	constructor(specs: DependenciesSpecs) {
		this.#specs = specs;
	}

	/**
	 * Generates a CRC32 hash for the given dependencies specifications.
	 * @param specs The dependencies specifications to hash.
	 * @returns The CRC32 hash as a string.
	 */
	update(): void {
		const compute: Record<string, { version: string; kind: string }> = {};
		this.#specs.forEach(({ version, kind }, key) => {
			compute[key] = { version, kind };
		});
		this.#value = crc32(equal.generate(compute));
	}
}
