import type { Processor } from '..';
import type { IProcessorExtenderStrategy } from '../types';
import { Preprocessor } from './preprocessor';
import { Extensions } from './extensions';

export class ProcessorExtender {
	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#preprocessor: Preprocessor;
	get preprocessor(): Preprocessor {
		return this.#preprocessor;
	}

	#extensions: Extensions;
	get extensions(): Extensions {
		return this.#extensions;
	}

	constructor(processor: Processor, strategy: IProcessorExtenderStrategy) {
		if (typeof strategy !== 'object' || !strategy.Preprocessor || !Array.isArray(strategy.extends)) {
			const { name } = processor;
			throw new Error(`Processor "${name}" error: Invalid strategy provided to the processor extender`);
		}
		if (!processor.sources?.inputs) {
			const { name } = processor;
			throw new Error(
				`Processor "${name}" error: "sources.inputs" specification is required when using an extender`
			);
		}

		this.#processor = processor;

		const { Preprocessor } = strategy;
		this.#preprocessor = new Preprocessor(processor, strategy.extends);

		this.#extensions = new Extensions(this.#preprocessor, strategy.extends);
	}
}
