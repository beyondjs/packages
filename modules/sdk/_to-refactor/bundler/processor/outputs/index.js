module.exports = class {
	#ims;
	get ims() {
		return this.#ims;
	}

	#types;
	get types() {
		return this.#types;
	}

	#css;
	get css() {
		return this.#css;
	}

	constructor(processor, strategy) {
		this.processor = processor;

		this.#ims = strategy.InternalModules && new strategy.InternalModules(processor);
		this.#types = strategy.Types && new strategy.Types(processor);
		this.#css = strategy.Css && new strategy.Css(processor);
	}
};
