const ProcessorSources = require('./sources');
const ProcessorExtender = require('./extender');
const ProcessorSettings = require('./settings');
const ProcessorSpecs = require('./specs');
const ProcessorOutputs = require('./outputs');
const { join } = require('path');

module.exports = class {
	get dp() {
		return 'bundler.processor';
	}

	#conditional;
	get conditional() {
		return this.#conditional;
	}

	#name;
	get name() {
		return this.#name;
	}

	#specifier;
	get specifier() {
		return this.#specifier;
	}

	/**
	 * The settings object for the processor as specified in the package.json file
	 */
	#settings;
	get settings() {
		return this.#settings;
	}

	/**
	 * The specs object for the processor as specified in the modiule.json file
	 */
	#specs;
	get specs() {
		return this.#specs;
	}

	get path() {
		const path = this.#conditional.module.path.dirname;
		const specs = this.#specs.values;
		return join(path, specs.path || '');
	}

	#strategy;
	get strategy() {
		return this.#strategy;
	}

	#sources;
	get sources() {
		return this.#sources;
	}

	#extender;
	get extender() {
		return this.#extender;
	}

	#outputs;
	get outputs() {
		return this.#outputs;
	}

	/**
	 * The bundler processor constructor
	 * @param {object} conditional - The module conditional
	 * @param {string} name - The name of the processor
	 * @param {string} specifier - The specifier of the processor
	 * @param {object} strategy
	 */
	constructor(conditional, name, specifier, strategy) {
		this.#conditional = conditional;
		this.#name = name;
		this.#specifier = specifier;
		this.#strategy = strategy;

		if (!strategy) {
			throw new Error(`Processor "${specifier}" error: "strategy" specification is required`);
		}

		const Settings = strategy.Settings || ProcessorSettings;
		this.#settings = new Settings(this);

		const Specs = strategy.Specs || ProcessorSpecs;
		this.#specs = new Specs(this);

		const Sources = strategy.sources && (strategy.sources.Sources || ProcessorSources);
		this.#sources = Sources && new Sources(this, strategy.sources);

		const Extender = strategy.extender && (strategy.extender?.Extender || ProcessorExtender);
		this.#extender = Extender && new Extender(this, strategy.extender);

		this.#outputs = strategy.outputs && new ProcessorOutputs(this, strategy.outputs);
	}

	/**
	 * This method can be overriden to provide the specs values required for its processing
	 *
	 * @param {*} values
	 * @returns
	 */
	_specs(values) {
		// The processor should return only the specs (as set in the module.json) it will require for its processing
		// Take into account that a change in the specs values will invalidate the processor
		const output = {};
		if (this.#sources.inputs) {
			values.path && (output.path = values.path);
			values.files && (output.files = values.files);
		}

		return { values: output };
	}

	/**
	 * This method can be overriden to provide the settings (as set in the package.json) required for its processing
	 *
	 * @param {*} values
	 * @returns
	 */
	_settings(values) {
		// The processor should return only the settings it will require for its processing
		// Take into account that a change in the settings will invalidate the processor

		void values;
		return { values: {} };
	}
};
