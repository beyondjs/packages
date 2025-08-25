import type { IDiagnostic } from '@beyond-js/finder/types';
import type { BaseConditional } from './';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export class ConditionalSpec extends DynamicProcessor() {
	get dp() {
		return 'module.conditional.spec';
	}

	#conditional: BaseConditional;

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings;
	}

	valid(): boolean {
		return !this.#errors?.length;
	}

	#values: object | string;
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
		let { errors, warnings, values } = conditional._spec(conditional.module.spec.values);
		errors = errors || [];
		warnings = warnings || [];
		values = values || {};

		const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
		const changed = !equal(previous, { errors, warnings, values });
		if (!changed) return false;

		this.#errors = errors;
		this.#warnings = warnings;
		this.#values = values;
	}
}
