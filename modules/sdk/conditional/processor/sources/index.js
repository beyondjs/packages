const SourcesInputs = require('./inputs');
const SourcesFiles = require('./files');
const SourcesHash = require('./hash');

module.exports = class {
	#processor;
	get processor() {
		return this.#processor;
	}

	#inputs;
	get inputs() {
		return this.#inputs;
	}

	#files;
	get files() {
		return this.#files;
	}

	#hash;
	get hash() {
		return this.#hash;
	}

	constructor(processor, strategy) {
		this.#processor = processor;

		const Inputs = strategy.inputs && (strategy.inputs.Inputs || SourcesInputs);
		this.#inputs = Inputs && new Inputs(processor, strategy.inputs);

		const Files = strategy.files && SourcesFiles;
		this.#files = Files && new SourcesFiles(processor, strategy.files);

		const Hash = strategy.Hash || SourcesHash;
		this.#hash = new Hash(this);
	}

	destroy() {
		this.#inputs.destroy();
		this.#files?.destroy();
		this.#hash.destroy();
	}
};
