import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { IDiagnostic } from '@beyond-js/packages/types';

export interface IDelegatedValues {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	code?: string;
	map?: string;
}

export /*bundle*/ class Delegated implements IDelegatedValues {
	#file: DynamicFile;
	get file() {
		return this.#file;
	}

	/**
	 * The file code and hash can change, so keep track of the value of the file when the item was created.
	 * This allows us to determine if the item has changed since it was created.
	 */
	#hash: string;
	get hash() {
		return this.#hash;
	}

	#code: string;
	get code() {
		return this.#code;
	}

	#map: string;
	get map(): string {
		return this.#map;
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

	constructor(file: DynamicFile, { errors, warnings, code, map }: IDelegatedValues) {
		this.#file = file;
		this.#hash = file.hash;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#code = code;
		this.#map = map;
	}
}
