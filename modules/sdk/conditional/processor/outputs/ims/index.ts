import type { ConditionalProcessor } from '../..';
import { ProcessorOutputsBase } from '../base';

export class ImsOutput extends ProcessorOutputsBase {
	get dp() {
		return 'processor.outputs.internal-modules';
	}

	constructor(processor: ConditionalProcessor) {
		super(processor, 'ims');
	}
}
