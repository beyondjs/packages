import type { IDiagnostic } from '@beyond-js/packages/types';
import { Extensions } from './extensions';

export class PreprocessorItem {
	#source;
	get source() {
		return this.#source;
	}

	#extensions: Extensions;
	get extensions() {
		return this.#extensions;
	}

	/**
	 * The source content and hash can change, so keep track of the value of the source when the item was created.
	 * This allows us to determine if the item has changed since it was created.
	 */
	#hash: string;
	get hash() {
		return this.#hash;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors.length;
	}

	constructor(source, extensions: string[]) {
		this.#source = source;
		this.#extensions = new Extensions(source, extensions);
	}

	set(values: { errors?: IDiagnostic[]; warnings?: IDiagnostic[] }) {
		if (typeof values !== 'object') throw new Error(`Invalid parameters, 'values' must be an object`);
		const { errors, warnings } = values;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
	}
}
