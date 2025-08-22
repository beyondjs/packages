const BundlerProcessors = require('@beyond-js/bundlers-sdk/bundler/processors');

module.exports = class extends BundlerProcessors {
	get dp() {
		return 'bundler.processors.resolver';
	}

	constructor(conditional) {
		super(conditional);

		super.setup(
			new Map([
				// Derived from the module specs: specified in the module.json file
				['conditional-specs', { child: conditional.specs }],
				// The module settings: specified in the package.json file (bundlers property)
				['bundler-settings', { child: conditional.module.bundler.settings }]
			])
		);
	}

	_resolve(name) {
		const module = this.conditional.module;
		const settings = module.bundler.settings.values;

		let found = settings.processors[name];
		if (!found) {
			return { error: `Processor "${name}" not found in the bundler settings` };
		}

		found = typeof found === 'string' ? { specifier: found } : found;
		if (typeof found !== 'object') {
			return { error: `Processor "${name}" is invalid. An object or a string is expected` };
		}

		const { specifier } = found;
		if (typeof specifier !== 'string' || !specifier) {
			return { error: `Processor "${name}" does not have a valid specifier` };
		}

		return { specifier };
	}
};
