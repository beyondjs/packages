const Outputs = require('./outputs');

module.exports = class {
	#db = require('./db');
	#bundler;

	#outputs;
	get outputs() {
		return this.#outputs;
	}

	constructor(bundler) {
		this.#bundler = bundler;
		this.#outputs = new Outputs(this.#bundler, this.#db);
	}

	/**
	 * Delete the bundler data from the store.
	 * Removes all data related to the bundler, including outputs.
	 */
	async delete() {
		try {
			const sentence = 'DELETE FROM bundlers WHERE bundler_id=?; DELETE FROM outputs WHERE bundler_id=?';
			await this.#db.run(sentence, [this.#bundler.id, this.#bundler.id]);
		} catch (exc) {
			const error = `Error deleting bundler data from cache: ${exc.stack}`;
			return { error };
		}
	}
};
