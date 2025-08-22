const OutputsBase = require('@beyond-js/bundlers-sdk/bundler/processor/outputs/base');

module.exports = class extends OutputsBase {
	get dp() {
		return 'processor.outputs.ims';
	}

	constructor(processor) {
		super(processor, 'ims');
	}
};
