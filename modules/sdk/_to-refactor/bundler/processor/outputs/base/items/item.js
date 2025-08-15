const Generated = require('./generated');
const Issues = require('./issues');
const crc32 = require('@beyond-js/crc32');

module.exports = class {
	#source;
	get source() {
		return this.#source;
	}

	#issues = new Issues();
	get issues() {
		return this.#issues;
	}

	#generated = new Generated();
	get generated() {
		return this.#generated;
	}

	constructor(source) {
		this.#source = source;
	}
};
