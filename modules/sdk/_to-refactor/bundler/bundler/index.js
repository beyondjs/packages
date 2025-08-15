const Conditional = require('@beyond-js/bundlers-sdk/conditional');
const Processors = require('@beyond-js/bundlers-sdk/bundler/processors');
const BundlerStore = require('./store');
const ESMOutput = require('./outputs/esm');
const LocalOutput = require('./outputs/local');
const TypesOutput = require('./outputs/types');
const CSSOutput = require('./outputs/css');

module.exports = class extends Conditional {
	#processors;
	get processors() {
		return this.#processors;
	}

	#store;
	get store() {
		return this.#store;
	}

	constructor(module, conditions, strategy) {
		if (typeof strategy !== 'object') {
			throw new Error(`Invalid strategy on module "${module.specifier}". An object is expected`);
		}
		if (!strategy.Processors && !strategy.processors) {
			throw new Error(`Invalid strategy on module "${module.specifier}". A Processors class is expected`);
		}
		if (typeof strategy.outputs !== 'object') {
			throw new Error(`Invalid strategy on module "${module.specifier}". An outputs object is expected`);
		}

		const { esm, local, types, css } = strategy.outputs;
		const outputs = new Map();
		esm && outputs.set('esm', Object.assign(esm, { Output: ESMOutput }));
		local && outputs.set('local', Object.assign(local, { Output: LocalOutput }));
		types && outputs.set('types', Object.assign(types, { Output: TypesOutput }));
		css && outputs.set('css', Object.assign(css, { Output: CSSOutput }));
		if (!outputs.size) {
			throw new Error(
				`Invalid outputs specification for module "${module.specifier}". At least one output is expected`
			);
		}

		super(module, conditions);

		this.#processors = strategy.processors
			? new Processors(this, strategy.processors)
			: new strategy.Processors(this);

		this.#store = new BundlerStore(this);

		super._initialize({ outputs });
	}
};
