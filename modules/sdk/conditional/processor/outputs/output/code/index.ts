import { ConditionalOutput } from '@beyond-js/packages/module/output';

export type CodeOutputType = 'raw-code' | 'sourcemap-inline';

export type MapType = 'string' | 'object' | 'base64';

export class CodeOutput extends ConditionalOutput {
	#exports = new Set<string>();
	get exports() {
		return this.#exports;
	}

	set(values: { code: string; map: string | object }) {
		if (typeof values !== 'object') throw new Error('Invalid parameters');

		const { code, map } = values;
		super.set({ code, map });
	}
}
