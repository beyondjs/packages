const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const equal = require('@beyond-js/equal');

export class ManifestConditionalSpec extends DynamicProcessor {
	get dp() {
		return 'module.conditional.specs';
	}

	#conditional;

	#values = {};
	get values() {
		return this.#values;
	}

	constructor(conditional) {
		super();
		this.#conditional = conditional;
		const specs = conditional.module.specs;
		super.setup(new Map([['specs', { child: specs }]]));
	}

	_process() {
		const conditional = this.#conditional;
		let values = conditional._specs(conditional.module.specs.values);
		values = values || {};

		const changed = !equal(values, this.#values);
		if (!changed) return false;
		this.#values = values;
	}
}
