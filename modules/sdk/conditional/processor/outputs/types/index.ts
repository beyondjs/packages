import type { ConditionalProcessor } from '../..';
import { ProcessorOutputsBase } from '../base';

export class TypesOutput extends ProcessorOutputsBase {
	get dp() {
		return 'processor.outputs.types';
	}

	constructor(processor: ConditionalProcessor) {
		super(processor, 'types');
	}
}
