import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { IDelegatedValues } from './delegated';
import { Delegated } from './delegated';

export class Delegates extends Map<string, Delegated> {
	#delegates: string[];

	#file: DynamicFile;
	get file() {
		return this.#file;
	}

	constructor(file: DynamicFile, delegates: string[]) {
		if (!Array.isArray(delegates) || !delegates.length)
			throw new Error(`Invalid parameters, 'delegates' must be a non-empty array`);

		super();
		this.#file = file;
		this.#delegates = delegates;
	}

	update(name: string, values: IDelegatedValues) {
		if (!this.#delegates.includes(name)) {
			throw new Error(`Invalid parameters, '${name}' is not defined in the delegates list`);
		}
		if (typeof values !== 'object') {
			throw new Error(`Invalid parameters, 'values' must be an object`);
		}

		const { errors, warnings, content, map } = values;
		const delegated = new Delegated(this.#file, { errors, warnings, content, map });
		super.set(name, delegated);
	}
}
