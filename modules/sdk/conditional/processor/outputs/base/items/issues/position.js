module.exports = class {
	#is;
	get is() {
		return this.#is;
	}

	#line;
	get line() {
		return this.#line;
	}
	#column;
	get column() {
		return this.#column;
	}

	#start;
	get start() {
		return this.#start;
	}
	#end;
	get end() {
		return this.#end;
	}

	constructor({ line, column, start, end } = {}) {
		if (typeof line !== 'number' || typeof column !== 'number') {
			throw new Error('Invalid parameters: line and column must be numbers');
		}
		if (start && typeof start !== 'number') {
			throw new Error('Invalid parameter: start must be a number');
		}
		if (end && typeof end !== 'number') {
			throw new Error('Invalid parameter: end must be a number');
		}

		// Infer the type based on the presence of start and end or just line and column
		this.#is = start || end ? 'range' : 'position';

		this.#line = line;
		this.#column = column;
		this.#start = start;
		this.#end = end;
	}
};
