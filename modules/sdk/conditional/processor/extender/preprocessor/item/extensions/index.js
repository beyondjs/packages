const crc32 = require('@beyond-js/crc32');
const Extension = require('./extension');

module.exports = class extends Map {
	#extensions;

	#source;
	get source() {
		return this.#source;
	}

	constructor(source, extensions) {
		if (!Array.isArray(extensions) || !extensions.length)
			throw new Error(`Invalid parameters, 'extensions' must be a non-empty array`);

		super();
		this.#source = source;
		this.#extensions = extensions;
	}

	set(extending, values) {
		if (!this.#extensions.includes(extending))
			throw new Error(`Invalid parameters, '${extending}' is not defined in the extensions list`);
		if (typeof values !== 'object') throw new Error(`Invalid parameters, 'values' must be an object`);

		const { errors, warnings, content, map } = values;
		const extension = new Extension(this.#source, { errors, warnings, content, map });
		super.set(extending, extension);
	}
};
