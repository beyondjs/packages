import { ConditionalOutput } from '@beyond-js/packages/module/output';

export type CodeOutputType = 'raw-code' | 'sourcemap-inline';

export type MapType = 'string' | 'object' | 'base64';

export class ArtifactCode extends ConditionalOutput {
	#exports: Set<string>;
	get exports() {
		return this.#exports;
	}

	set(values: { code: string; map: string | object; exports?: Set<string> }) {
		if (typeof values !== 'object') throw new Error('Invalid parameters');

		const { code, map, exports } = values;
		super.set({ code, map });

		if (exports && !(exports instanceof Set)) {
			throw new Error('Invalid exports property. It must be a Set.');
		}
		this.#exports = exports ? exports : new Set();
	}
}
