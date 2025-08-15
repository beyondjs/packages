const Extensions = require('./extensions');

module.exports = class {
	#processor;
	get processor() {
		return this.#processor;
	}

	#preprocessor;
	get preprocessor() {
		return this.#preprocessor;
	}

	#extensions;
	get extensions() {
		return this.#extensions;
	}

	constructor(processor, strategy) {
		if (typeof strategy !== 'object' || !strategy.Preprocessor || !Array.isArray(strategy.extends)) {
			const { specifier } = processor;
			throw new Error(`Processor "${specifier}" error: Invalid strategy provided to the processor extender`);
		}
		if (!processor.sources?.inputs) {
			const { specifier } = processor;
			throw new Error(
				`Processor "${specifier}" error: "sources.inputs" specification is required when using an extender`
			);
		}

		this.#processor = processor;

		const { Preprocessor } = strategy;
		this.#preprocessor = new Preprocessor(processor, strategy.extends);

		this.#extensions = new Extensions(this.#preprocessor, strategy.extends);
	}
};
