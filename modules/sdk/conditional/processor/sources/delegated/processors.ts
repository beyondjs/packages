import type { Processor } from '../../';
import type { Delegator } from '../../delegator/delegators/delegator';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

/**
 * The extensions hashes of the processors that are extending the current processor.
 * Example: if the processor is "ts", an extension of it could be the "ts" extension of the "svelte" processor
 */
export class DelegatingProcessors extends DynamicProcessor(Map<string, Delegator>) {
	get dp() {
		return 'processor.sources.extensions.processors';
	}

	#processor: Processor;
	get processor() {
		return this.#processor;
	}

	constructor(processor: Processor) {
		super();
		this.#processor = processor;

		const { processors } = processor.conditional;
		super.setup(new Map([['conditional-processors', { child: processors }]]));
	}

	_process() {
		const { processors } = this.#processor.conditional;

		/**
		 * Loop through the processors in the bundle to find which ones delegates to the current processor
		 */
		const updated = new Map();
		processors.forEach(processor => {
			if (!processor.delegator) return;

			const { delegators } = processor.delegator;
			if (!delegators.has(this.#processor.name)) return;

			const delegator = delegators.get(this.#processor.name);
			updated.set(processor.name, delegator);
		});

		let changed = updated.size !== this.size || [...updated.values()].some(processor => !this.has(processor));
		if (!changed) return false;

		this.clear();
		updated.forEach((value, key) => this.set(key, value));
	}
}
