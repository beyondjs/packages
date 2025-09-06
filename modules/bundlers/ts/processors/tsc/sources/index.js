const Sources = require('@beyond-js/bundlers-sdk/bundler/processor/sources');
const TsConfig = require('../../tsconfig');
const Hash = require('./hash');

module.exports = class extends Sources {
	constructor(processor) {
		super(processor, {
			Hash,
			inputs: { extname: ['.ts', '.tsx'] },
			files: [{ file: 'tsconfig.json', File: TsConfig }]
		});
	}
};
