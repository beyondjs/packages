import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { IDiagnostic } from '@beyond-js/packages/types';

export interface IDelegatedValues {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	content?: string;
	map?: string;
}

export class Delegated implements IDelegatedValues {
	#file: DynamicFile;
	get file() {
		return this.#file;
	}

	/**
	 * The file content and hash can change, so keep track of the value of the file when the item was created.
	 * This allows us to determine if the item has changed since it was created.
	 */
	#hash;
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

	#content: string;
	get content() {
		return this.#content;
	}

	#map: string;
	get map(): string {
		return this.#map;
	}

	constructor(file: DynamicFile, { errors, warnings, content, map }: IDelegatedValues) {
		this.#file = file;
		this.#hash = file.hash;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#content = content;
		this.#map = map;
	}
}
