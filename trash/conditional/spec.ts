import type { BaseConditional } from './';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export class ConditionalSpec extends DynamicProcessor() {
	get dp() {
		return 'module.conditional.spec';
	}

	#conditional: BaseConditional;

	#values = {};
	get values() {
		return this.#values;
	}

	constructor(conditional: BaseConditional) {
		super();

		this.#conditional = conditional;
		const spec = conditional.module.spec;
		super.setup(new Map([['spec', { child: spec }]]));
	}

	_process() {
		const conditional = this.#conditional;
		let { values } = conditional._spec(conditional.module.spec.values);
		values = values || {};

		console.log('Processing conditional spec', values);

		const changed = !equal(values, this.#values);
		if (!changed) return false;
		this.#values = values;
	}
}
