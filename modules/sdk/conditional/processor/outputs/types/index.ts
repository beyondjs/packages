import type { Processor } from '../..';
import { ProcessorOutputsBase } from '../base';

export class TypesOutputs extends ProcessorOutputsBase {
	get dp() {
		return 'processor.outputs.types';
	}

	constructor(processor: Processor) {
		super(processor, 'types');
	}
}
