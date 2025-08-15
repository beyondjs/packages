const crc32 = require('@beyond-js/crc32');
const Extensions = require('./extensions');

module.exports = class {
	#source;
	get source() {
		return this.#source;
	}

	#extensions;
	get extensions() {
		return this.#extensions;
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

	constructor(source, extensions) {
		this.#source = source;
		this.#extensions = new Extensions(source, extensions);
	}

	set(values) {
		if (typeof values !== 'object') throw new Error(`Invalid parameters, 'values' must be an object`);
		const { errors, warnings } = values;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
	}
};
