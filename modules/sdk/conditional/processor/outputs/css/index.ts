import type { ConditionalProcessor } from '../..';
import { ProcessorOutputsBase } from '../base';

export class CssOutput extends ProcessorOutputsBase {
	get dp() {
		return 'processor.outputs.css';
	}

	constructor(processor: ConditionalProcessor) {
		super(processor, 'css');
	}
}
