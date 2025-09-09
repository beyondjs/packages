import type { IDiagnostic } from '@beyond-js/packages/types';
import type { DynamicFile } from '@beyond-js/file/dynamic';
import { Delegates } from './delegates';

export class PreprocessedFile {
	#file: DynamicFile;
	get file() {
		return this.#file;
	}

	#delegates: Delegates;
	get delegates() {
		return this.#delegates;
	}

	/**
	 * The file content and hash can change, so keep track of the value of the file when the item is updated.
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

	get valid(): boolean {
		return !this.#errors.length;
	}

	constructor(file: DynamicFile, delegates: string[]) {
		this.#file = file;
		this.#delegates = new Delegates(file, delegates);
	}

	update(values: { errors?: IDiagnostic[]; warnings?: IDiagnostic[] }) {
		if (typeof values !== 'object') throw new Error(`Invalid parameters, 'values' must be an object`);
		const { errors, warnings } = values;

		// Update the hash of the item
		this.#hash = this.#file.hash;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
	}
}
