import type { Processor } from '../../processor';
import type { IProcessorSourcesStrategy } from '../types';
import { ProcessorSourcesInputs } from './inputs';
import { ProcessorSourcesFiles } from './files';
import { ProcessorSourcesHash } from './hash';

export class ProcessorSources {
	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#inputs: ProcessorSourcesInputs;
	get inputs(): ProcessorSourcesInputs {
		return this.#inputs;
	}

	#files: ProcessorSourcesFiles;
	get files(): ProcessorSourcesFiles {
		return this.#files;
	}

	#hash: ProcessorSourcesHash;
	get hash(): ProcessorSourcesHash {
		return this.#hash;
	}

	constructor(processor: Processor, strategy: IProcessorSourcesStrategy) {
		this.#processor = processor;

		const Inputs = strategy.inputs && (strategy.inputs.Inputs || ProcessorSourcesInputs);
		this.#inputs = Inputs && new Inputs(processor, strategy.inputs);

		const Files = strategy.files && ProcessorSourcesFiles;
		this.#files = Files && new Files(processor, strategy.files);

		const Hash = strategy.Hash || ProcessorSourcesHash;
		this.#hash = new Hash(this);
	}

	destroy() {
		this.#inputs.destroy();
		this.#files?.destroy();
		this.#hash.destroy();
	}
}
