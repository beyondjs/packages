import { BaseProcessor } from '@beyond-js/packages/sdk';
import { TsConfig } from '../tsconfig';
import { InternalModules } from './ims';
// import Analyzer  from './analyzer';
// import Dependencies  from './dependencies';

export class Processor extends BaseProcessor {
	constructor(...args) {
		super(...args, {
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
