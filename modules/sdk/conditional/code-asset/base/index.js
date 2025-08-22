const Asset = require('@beyond-js/bundlers-sdk/asset');
const SourceMap = require('@beyond-js/bundlers-sdk/source-map');
const ipc = require('@beyond-js/ipc/main');

module.exports = class extends ModuleConditional {
	get dp() {
		return 'module.conditional.bundler';
	}

	constructor(conditional, processors) {
		super(conditional);
	}
};
