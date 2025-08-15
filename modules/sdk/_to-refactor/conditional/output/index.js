const DynamicProcessor = require('@beyond-js/dynamic-processor')();

module.exports = class extends DynamicProcessor {
	#conditional;
	get conditional() {
		return this.#conditional;
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
		return !this.#errors?.length;
	}

	#code;
	get code() {
		return this.#code;
	}

	#map;
	get map() {
		return this.#map;
	}

	constructor(conditional, strategy) {
		super();

		void strategy; // eslint-disable-line no-unused-vars
		this.#conditional = conditional;
	}

	_build() {
		throw new Error(
			`Method '._build' must be overridden in the output processor for conditional "${
				this.#conditional.module.specifier
			}"`
		);
	}

	_process() {
		const { errors, warnings, code, map } = this._build();

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#code = code || '';
		this.#map = map || null;
	}
};
