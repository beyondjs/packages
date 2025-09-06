import type { Conditional } from '..';
import { db } from './db';
import { OutputsStore } from './outputs';

export class ConditionalsStore {
	#conditional: Conditional;

	#outputs: OutputsStore;
	get outputs() {
		return this.#outputs;
	}

	constructor(conditional: Conditional) {
		this.#conditional = conditional;
		this.#outputs = new OutputsStore(this.#conditional, db);
	}

	/**
	 * Delete the conditional data from the store.
	 * Removes all data related to the conditional, including outputs.
	 */
	async delete() {
		try {
			const sentence =
				'DELETE FROM conditionals WHERE conditional_id=?; DELETE FROM outputs WHERE conditional_id=?';
			await db.run(sentence, [this.#conditional.id, this.#conditional.id]);
		} catch (exc) {
			const error = `Error deleting conditional data from cache: ${exc.stack}`;
			return { error };
		}
	}
}
