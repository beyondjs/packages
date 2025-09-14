import type { Conditional } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { ProcessorOutputs } from '@beyond-js/packages/sdk';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { DynamicFileObject } from '@beyond-js/file/dynamic';
import { Exports } from './exports';
// import Analyzer  from './analyzer';
// import Dependencies  from './dependencies';

export /*bundle*/ class Processor extends ConditionalProcessor {
	constructor(conditional: Conditional, name: string) {
		super(conditional, name, {
			// Analyzer,
			// Dependencies,
			sources: {
				inputs: { extname: ['.ts', '.tsx'] },
				files: [{ file: 'tsconfig.json', json: true }]
			}
		});
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		const { inputs, files } = this.sources;

		const tsconfig = <DynamicFileObject>files.get('tsconfig.json');
		console.log('Building TSC processor', this.name, [...inputs.keys()], tsconfig.exists);

		const promises: Promise<void>[] = [];
		inputs.forEach(input => {
			console.log('Processing input:', input.file);

			const output = outputs.ims.obtain(input);
			promises.push(Exports.process(input, output));
		});

		await Promise.all(promises);
	}
}
