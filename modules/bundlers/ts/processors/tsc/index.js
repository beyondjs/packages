const Processor = require('@beyond-js/bundlers-sdk/bundler/processor');
const Sources = require('./sources');
const SourcesHash = require('./sources/hash');
const TypeOutputs = require('./types');

module.exports = class extends Processor {
	constructor(...args) {
		super(...args, {
			// Analyzer,
			sources: { Sources },
			outputs: { Types: TypeOutputs }
		});
	}
};
