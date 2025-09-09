import type { Processor } from '../';
import type { IProcessorOutputsStrategy } from '../types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

/**
 * The ProcessorsOutputs is a DynamicProcessor to allow conditional to process the outputs
 * both in the ProcessorOutputs and/or in the Output instances.
 */
export class ProcessorOutputs extends DynamicProcessor() {
	#ims;
	get ims() {
		return this.#ims;
	}

	#types;
	get types() {
		return this.#types;
	}

	#css;
	get css() {
		return this.#css;
	}

	#destroyed = false;
	get destroyed() {
		return this.#destroyed;
	}

	constructor(processor: Processor, strategy: IProcessorOutputsStrategy) {
		super();

		this.#ims = strategy.InternalModules && new strategy.InternalModules(processor);
		this.#css = strategy.Css && new strategy.Css(processor);
		this.#types = strategy.Types && new strategy.Types(processor);
	}

	destroy() {
		this.#ims?.destroy();
		this.#css?.destroy();
		this.#types?.destroy();

		this.#destroyed = true;
	}
}
