import type { Processor } from '../../processor';
import type { IProcessorSourcesStrategy } from '../types';
import { ProcessorInputs } from './inputs';
import { ProcessorFiles } from './files';
import { DelegationCollector } from './delegated';
import { ProcessorSourcesHash } from './hash';

export class ProcessorSources {
	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#inputs: ProcessorInputs;
	get inputs(): ProcessorInputs {
		return this.#inputs;
	}

	#files: ProcessorFiles;
	get files(): ProcessorFiles {
		return this.#files;
	}

	#delegated: DelegationCollector;
	get delegated(): DelegationCollector {
		return this.#delegated;
	}

	#hash: ProcessorSourcesHash;
	get hash(): ProcessorSourcesHash {
		return this.#hash;
	}

	constructor(processor: Processor, strategy: IProcessorSourcesStrategy) {
		this.#processor = processor;

		const Inputs = strategy.inputs && (strategy.inputs.Inputs || ProcessorInputs);
		this.#inputs = Inputs && new Inputs(processor, strategy.inputs);

		const Files = strategy.files?.length && ProcessorFiles;
		this.#files = Files && new Files(processor, strategy.files);

		const Delegated = strategy.delegated && DelegationCollector;
		this.#delegated = Delegated && new Delegated(processor);

		// The hash is always calculated
		const Hash = strategy.Hash || ProcessorSourcesHash;
		this.#hash = new Hash(this);
	}

	destroy() {
		this.#inputs.destroy();
		this.#files?.destroy();
		this.#delegated?.destroy();
		this.#hash.destroy();
	}
}
