const Position = require('./position');

module.exports = class {
	#type;
	get type() {
		return this.#type;
	}

	#code;
	get code() {
		return this.#code;
	}

	#message;
	get message() {
		return this.#message;
	}

	#position;
	get position() {
		return this.#position;
	}

	constructor(type, { code, message, position } = {}) {
		if (typeof type !== 'string') {
			throw new Error('Invalid parameter: type must be a string');
		}
		if (typeof code !== 'string' || typeof message !== 'string') {
			throw new Error('Invalid parameters: code and message must be strings');
		}
		if (position && typeof position !== 'object') {
			throw new Error('Invalid parameters: position must be an object');
		}

		this.#type = type;
		this.#code = code;
		this.#message = message;
		this.#position = position ? new Position(position) : void 0;
	}
};
