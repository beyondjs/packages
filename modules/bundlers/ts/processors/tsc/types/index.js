const TypeOutputs = require('@beyond-js/bundlers-sdk/bundler/processor/outputs/types');

module.exports = class extends TypeOutputs {
	async _build() {
		console.log('Type Outputs: _build method called');
	}

	hydrate(cached) {
		super.hydrate(cached);
	}

	serialize() {
		super.serialize({});
	}
};
