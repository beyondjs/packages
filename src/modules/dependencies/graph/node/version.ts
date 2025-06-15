import type { ErrorManager } from '@beyond-js/response/main';
import { EventEmitter } from 'events';

export class Version extends EventEmitter {
	#specified: string;
	get specified() {
		return this.#specified;
	}

	#resolved: string;
	get resolved() {
		return this.#resolved;
	}

	#error: ErrorManager;
	get error() {
		return this.#error;
	}

	constructor(specified: string, resolved?: string) {
		super();
		this.#specified = specified;
		this.#resolved = resolved;
	}

	update({ version, error }: { version?: string; error?: ErrorManager }) {
		const changed = ((this.#resolved || this.#error) && this.#resolved !== version) || this.#error !== error;

		this.#resolved = version;
		this.#error = error;
		changed && this.emit('change');
	}
}
