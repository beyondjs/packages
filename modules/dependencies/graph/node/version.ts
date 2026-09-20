import type { IDiagnostic } from '@beyond-js/packages/types';
import { EventEmitter } from 'events';

/**
 * The version a dependency occurrence declares and the one selected for it
 */
export class Version extends EventEmitter {
	#specified: string;
	/**
	 * The specifier in effect: the declared one, or the one an override replaced it with
	 */
	get specified() {
		return this.#specified;
	}

	#resolved: string;
	get resolved() {
		return this.#resolved;
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	constructor(specified: string, resolved?: string) {
		super();
		this.#specified = specified;
		this.#resolved = resolved;
	}

	update({ version, error }: { version?: string; error?: IDiagnostic }) {
		// Diagnostics are compared by content: an equal error built again is not a change
		const same = (a?: IDiagnostic, b?: IDiagnostic) => a?.code === b?.code && a?.message === b?.message;
		const changed = ((this.#resolved || this.#error) && this.#resolved !== version) || !same(this.#error, error);

		this.#resolved = version;
		this.#error = error;
		changed && this.emit('change');
	}
}
