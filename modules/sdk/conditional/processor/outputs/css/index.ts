import type { Processor } from '../..';
import { ProcessorOutputsBase } from '../base';

export class CssOutputs extends ProcessorOutputsBase {
	get dp() {
		return 'processor.outputs.css';
	}

	constructor(processor: Processor) {
		super(processor, 'css');
	}
}
