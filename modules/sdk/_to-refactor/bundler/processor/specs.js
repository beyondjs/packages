const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const equal = require('@beyond-js/equal');

module.exports = class ProcessorSpecs extends DynamicProcessor {
	get dp() {
		return 'processor.specs';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	#values = {};
	get values() {
		return this.#values;
	}
	set values(values) {
		let errors, warnings;
		({ values, errors, warnings } = this.#processor._specs(values));

		const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
		const changed = !equal({ values, errors, warnings }, previous);
		if (!changed) return false;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#values = values;
		this._invalidate();
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

	constructor(processor) {
		super();
		this.#processor = processor;
	}
};
