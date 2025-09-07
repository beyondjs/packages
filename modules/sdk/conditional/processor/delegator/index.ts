import type { Processor } from '..';
import type { IProcessorDelegatorStrategy } from '../types';
import { Preprocessor } from './preprocessor';
import { Delegates } from './delegates';

export class ProcessorDelegator {
	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#preprocessor: Preprocessor;
	get preprocessor(): Preprocessor {
		return this.#preprocessor;
	}

	#delegates: Delegates;
	get delegates(): Delegates {
		return this.#delegates;
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

		this.#delegates = new Delegates(this.#preprocessor, strategy.delegates);
	}

	destroy() {
		this.#preprocessor?.destroy();
		this.#delegates?.destroy();
		this.#destroyed = true;
	}
}
