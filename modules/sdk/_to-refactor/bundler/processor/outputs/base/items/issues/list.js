const Issue = require('./issue');

module.exports = class extends Array {
	#type;
	get type() {
		return this.#type;
	}

	constructor(type) {
		if (typeof type !== 'string') {
			throw new Error('Invalid parameter: type must be a string');
		}

		super();
		this.#type = type;
	}

	push(values) {
		if (typeof values !== 'object' || !values.code || !values.message) {
			throw new Error(
				'Invalid values provided to push method. Expected an object with code and message properties.'
			);
		}

		const { code, message, position } = values;
		super.push(new Issue(this.#type, { code, message, position }));
	}
};
