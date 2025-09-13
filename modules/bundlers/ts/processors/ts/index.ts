import type { Conditional } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { ProcessorOutputs } from '@beyond-js/packages/sdk';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
// import { TsConfig } from '../tsconfig';
// import Analyzer  from './analyzer';
// import Dependencies  from './dependencies';

export class Processor extends ConditionalProcessor {
	constructor(conditional: Conditional, name: string) {
		console.log('Creating TS processor', name);
		super(conditional, name, {
			// Analyzer,
			// Dependencies,
			sources: {
				inputs: { extname: ['.ts', '.tsx'] }
				// files: [{ file: 'tsconfig.json', File: TsConfig }]
			}
		});
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		console.log('Building TS processor', this.name);
		return;
	}
}
