import type { Conditional } from '..';
import type { OutputNameType, OutputsType, IOutput } from '@beyond-js/packages/module';
import { ESMOutput } from './esm';
import { LocalOutput } from './local';
import { TypesOutput } from './types';
import { CSSOutput } from './css';

export class Outputs extends Map<OutputNameType, IOutput> implements OutputsType {
	#conditional: Conditional;

	constructor(conditional: Conditional, strategy) {
		super();
		this.#conditional = conditional;

		const { esm, local, types, css } = strategy;
		const outputs = new Map();
		esm && outputs.set('esm', Object.assign(esm, { Output: ESMOutput }));
		local && outputs.set('local', Object.assign(local, { Output: LocalOutput }));
		types && outputs.set('types', Object.assign(types, { Output: TypesOutput }));
		css && outputs.set('css', Object.assign(css, { Output: CSSOutput }));
		if (!outputs.size) {
			throw new Error(`Invalid outputs specification. At least one output was expected`);
		}
	}

	clear() {
		this.forEach(output => output.destroy());
		super.clear();
	}

	destroy() {
		this.clear();
	}
}
