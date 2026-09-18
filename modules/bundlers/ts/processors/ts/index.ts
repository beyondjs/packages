import type { Conditional } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { ProcessorOutputs } from '@beyond-js/packages/sdk';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { Analyzer } from './analyzer';
import { Transpiler } from './transpiler';

/**
 * Turns the TypeScript sources of a public module into the internal modules its artifact is assembled from.
 *
 * Every `.ts`/`.tsx` file of the module is one internal module: it is transformed into the body of a runtime
 * creator and analyzed to obtain its exported names and its public dependencies. The public API is not
 * declared file by file; it is what the entry point of the module exports, which the assembly resolves from
 * these outputs.
 *
 * The `tsconfig.json` of the module is collected as an auxiliary source, so editing it reprocesses the
 * module. Its options do not drive this transformation, which is per-file and syntactic.
 */
export /*bundle*/ class Processor extends ConditionalProcessor {
	constructor(conditional: Conditional, name: string) {
		super(conditional, name, {
			sources: {
				inputs: { extname: ['.ts', '.tsx'] },
				files: [{ file: 'tsconfig.json', json: true }]
			}
		});
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		const promises: Promise<void>[] = [];

		this.sources.inputs.forEach(input => {
			// Declaration files describe types, they do not produce runtime code
			if (input.file.endsWith('.d.ts')) return;

			const output = outputs.ims.obtain(input);

			// A source that could not be read is reported: its module would otherwise be silently missing
			if (!input.valid) {
				output.issues.push('errors', { code: 'SOURCE_ERROR', message: input.errors.join('; ') });
				return;
			}

			Transpiler.process(input, output);
			promises.push(Analyzer.process(output));
		});

		await Promise.all(promises);
	}
}
