const List = require('./list');

module.exports = class {
	#errors = new List('error');
	get errors() {
		return this.#errors;
	}

	#warnings = new List('warning');
	get warnings() {
		return this.#warnings;
	}

	push(type, issue) {
		if (typeof type !== 'string' || !issue || typeof issue !== 'object') {
			throw new Error('Invalid parameters provided to push method.');
		}

		if (type === 'error') {
			this.#errors.push(issue);
		} else if (type === 'warning') {
			this.#warnings.push(issue);
		} else {
			throw new Error(`Unknown issue type: ${type}`);
		}
	}
};
