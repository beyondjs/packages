import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { ProcessorOutput } from '@beyond-js/packages/sdk';
import * as swc from '@swc/core';

export class Transpiler {
	static async process(input: DynamicFile, output: ProcessorOutput): Promise<void> {
		const tsx = input.extname === '.tsx';

		try {
			// Transpile the TypeScript/TSX code to javascript
			const result = await swc.transform(input.content, {
				filename: input.file,
				jsc: {
					target: 'es2022',
					parser: { syntax: 'typescript', tsx },
					transform: {},
					minify: { compress: false }
				},
				module: { type: 'es6' },
				sourceMaps: true
			});

			const { code, map } = result;
			output.code.set({ code, map });
		} catch (error) {
			output.issues.push('errors', {
				code: 'TRANSPILE_ERROR',
				message: error.message
			});
		}
	}
}
