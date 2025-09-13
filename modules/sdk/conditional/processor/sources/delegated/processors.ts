import type { ConditionalProcessor } from '../../';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { OutputsCollection } from '../../outputs/collection';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

/**
 * The extensions hashes of the processors that are extending the current processor.
 * Example: if the processor is "ts", an extension of it could be the "ts" extension of the "svelte" processor
 */
export class DelegatingProcessors extends DynamicProcessor(Map<string, OutputsCollection>) {
	get dp() {
		return 'processor.sources.extensions.processors';
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid(): boolean {
		return !this.errors.length;
	}

	#processor: ConditionalProcessor;
	get processor() {
		return this.#processor;
	}

	constructor(processor: ConditionalProcessor) {
		super();
		this.#processor = processor;

		const { processors } = processor.conditional;
		super.setup(new Map([['conditional-processors', { child: processors }]]));
	}

	_prepared(require: RequireType) {
		const { processors } = this.#processor.conditional;
		processors.forEach(processor => {
			processor.delegates.has(this.#processor.name) && require(processor, processor.name);
		});
	}

	_process() {
		const { processors } = this.#processor.conditional;

		/**
		 * Loop through the processors in the bundle to find which ones delegates to the current processor
		 */
		const updated = new Map();
		const errors: IDiagnostic[] = [];

		processors.forEach(processor => {
			if (!processor.delegates.has(this.#processor.name)) return;

			if (!processor.valid) {
				const code = 'PROCESSOR_ERROR';
				const message = `Delegator processor "${processor.name}" has been processed with errors`;
				errors.push({ code, message });
				return;
			}

			const outputs = processor.outputs.delegated.get(this.#processor.name);
			updated.set(processor.name, outputs);
		});

		this.clear();
		updated.forEach((value, key) => this.set(key, value));
	}
}
