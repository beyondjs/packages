import type { Conditional } from '@beyond-js/packages/sdk';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { TsConfig } from '../tsconfig';
import { InternalModules } from './ims';
// import Analyzer  from './analyzer';
// import Dependencies  from './dependencies';

export class Processor extends ConditionalProcessor {
	constructor(conditional: Conditional, name: string) {
		super(conditional, name, {
			// Analyzer,
			// Dependencies,
			sources: {
				inputs: { extname: ['.ts', '.tsx'] },
				files: [{ file: 'tsconfig.json', File: TsConfig }]
			},
			outputs: { InternalModules }
		});
	}
}
