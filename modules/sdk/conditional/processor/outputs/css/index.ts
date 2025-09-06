import OutputsBase from '@beyond-js/bundlers-sdk/bundler/processor/outputs/base';

export class CssOutputs extends OutputsBase {
	get dp() {
		return 'processor.outputs.css';
	}

	constructor(processor) {
		super(processor, 'css');
	}
}
