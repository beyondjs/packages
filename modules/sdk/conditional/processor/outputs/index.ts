import type { Processor } from '../';
import type { IProcessorOutputsStrategy } from '../types';

export class ProcessorOutputs {
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
