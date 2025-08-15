const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const equal = require('@beyond-js/equal');

module.exports = class ProcessorSettings extends DynamicProcessor {
	get dp() {
		return 'processor.settings';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	#values = {};
	get values() {
		return this.#values;
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
		const bundler = processor.conditional.module.bundler;

		super.setup(new Map([['bundler-settings', { child: bundler.settings }]]));
	}

	_process() {
		const bundler = processor.conditional.module.bundler;
		const { processors } = bundler.settings.values;
		let values = processors[this.#processor.name];
		values = values || {};

		let errors, warnings;
		({ values, errors, warnings } = this.#processor._settings(values));

		const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
		const changed = !equal({ values, errors, warnings }, previous);
		if (!changed) return false;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#values = values;
	}
};
