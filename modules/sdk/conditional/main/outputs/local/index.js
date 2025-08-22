const Output = require('@beyond-js/bundlers-sdk/conditional/output');
const InternalModules = require('@beyond-js/bundlers-sdk/bundler/ims');

module.exports = class extends Output {
	get dp() {
		return 'bundler.output.local';
	}

	#ims;

	constructor(...args) {
		super(...args);
		this.#ims = new InternalModules(this.conditional.processors);
		super.setup(new Map([['ims', { child: this.#ims }]]));
	}
};
