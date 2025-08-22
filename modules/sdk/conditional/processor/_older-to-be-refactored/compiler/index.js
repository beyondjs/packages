const DynamicProcessor = require('@beyond-js/dynamic-processor')(Map);

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.processor.compiler';
	}

	#processor;
	get processor() {
		return this.#processor;
	}
};
