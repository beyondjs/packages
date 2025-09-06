const Hash = require('@beyond-js/bundlers-sdk/bundler/processor/sources/hash');

module.exports = class extends Hash {
	get dp() {
		return 'ts.processor.sources.hash';
	}

	constructor(...args) {
		super(...args);

		// const { hashes } = processor.dependencies.declarations;
		// super.setup(new Map([['declarations.hashes', { child: hashes }]]));
	}

	_compute() {
		// return this.children.get('declarations.hashes').child.value;
	}
};
