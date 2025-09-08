import type { Processor } from '..';
import type { IProcessorDelegatorStrategy } from '../types';
import { Preprocessor } from './preprocessor';
import { Delegators } from './delegators';

export class ProcessorDelegator {
	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#preprocessor: Preprocessor;
	get preprocessor(): Preprocessor {
		return this.#preprocessor;
	}

	#delegators: Delegators;
	get delegators(): Delegators {
		return this.#delegators;
	}

	#destroyed = false;
	get destroyed() {
		return this.#destroyed;
	}

	constructor(processor: Processor, strategy: IProcessorDelegatorStrategy) {
		if (typeof strategy !== 'object' || !strategy.Preprocessor || !Array.isArray(strategy.delegates)) {
			const { name } = processor;
			throw new Error(`Processor "${name}" error: Invalid strategy provided to the processor delegator`);
		}
		if (!processor.sources?.inputs) {
			const { name } = processor;
			throw new Error(
				`Processor "${name}" error: "sources.inputs" specification is required when using an delegator`
			);
		}

		this.#processor = processor;

		const { Preprocessor } = strategy;
		this.#preprocessor = new Preprocessor(processor, strategy.delegates);

		this.#delegators = new Delegators(this.#preprocessor, strategy.delegates);
	}

	destroy() {
		this.#preprocessor?.destroy();
		this.#delegators?.destroy();
		this.#destroyed = true;
	}
}
