const Output = require('@beyond-js/bundlers-sdk/conditional/output');

module.exports = class extends Output {
	get dp() {
		return 'bundler.output.types';
	}
};
