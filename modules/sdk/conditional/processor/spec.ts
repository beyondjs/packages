import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Processor } from '../processor';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export class ProcessorSpec extends DynamicProcessor() {
	get dp() {
		return 'processor.spec';
	}

	#processor: Processor;
	get processor() {
		return this.#processor;
	}

	#values: Record<string, any> = {};
	get values() {
		return this.#values;
	}
	set values(values: Record<string, any>) {
		let errors, warnings;
		({ values, errors, warnings } = this.#processor._spec(values));

		const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
		const changed = !equal({ values, errors, warnings }, previous);
		if (!changed) return;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#values = values;
		this._invalidate();
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	constructor(processor: Processor) {
		super();
		this.#processor = processor;
	}
}
