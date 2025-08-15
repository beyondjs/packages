module.exports = class {
	#key;
	get key() {
		return this.#key;
	}

	#conditional;
	get conditional() {
		return this.#conditional;
	}

	constructor(key, conditional) {
		this.#key = key;
		this.conditional = conditional;
	}

	async code() {
		throw new Error('The method code() must be implemented');
	}

	async map() {
		throw new Error('The method map() must be implemented');
	}
};
