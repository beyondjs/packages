const DynamicProcessor = require('@beyond-js/dynamic-processor')(Map);
const SourceFile = require('./file');

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.processor.sources.files';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	constructor(processor, strategy) {
		super();
		this.#processor = processor;

		const error = `Processor strategy on processor "${processor.name}" is invalid`;
		if (!(strategy instanceof Array)) throw new Error(`${error}: files sources must be an array`);

		strategy.forEach(strategy => {
			if (typeof strategy !== 'object') throw new Error(`${error}: file item must be an object`);

			const { file } = strategy;
			if (typeof file !== 'string' || !file) throw new Error(`${error}: file property of file item must be set`);

			const File = strategy.File || SourceFile;
			this.set(file, new File(processor, file));
		});
	}

	#hash;
	get hash() {
		return this.#hash;
	}
};
