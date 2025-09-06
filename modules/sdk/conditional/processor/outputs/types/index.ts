import OutputsBase from '@beyond-js/bundlers-sdk/bundler/processor/outputs/base';

export class TypesOutputs extends OutputsBase {
	get dp() {
		return 'processor.outputs.types';
	}

	constructor(processor) {
		super(processor, 'types');
	}
}
