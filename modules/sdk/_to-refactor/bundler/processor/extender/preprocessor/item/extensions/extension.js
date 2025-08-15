module.exports = class {
	#source;
	get source() {
		return this.#source;
	}

	/**
	 * The source content and hash can change, so keep track of the value of the source when the item was created.
	 * This allows us to determine if the item has changed since it was created.
	 */
	#hash;
	get hash() {
		return this.#hash;
	}

	#errors = [];
	get errors() {
		return this.#errors;
	}

	#warnings = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors.length;
	}

	#content;
	get content() {
		return this.#content;
	}

	#map;
	get map() {
		return this.#map;
	}

	constructor(source, { errors, warnings, content, map }) {
		this.#source = source;
		this.#hash = source.hash;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#content = content;
		this.#map = map;
	}
};
