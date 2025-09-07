import type { Processor } from '../..';
import { ProcessorOutputsBase } from '../base';

export class ImsOutput extends ProcessorOutputsBase {
	get dp() {
		return 'processor.outputs.internal-modules';
	}

	constructor(processor: Processor) {
		super(processor, 'ims');
	}
}
