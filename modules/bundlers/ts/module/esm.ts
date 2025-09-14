import type { IProcessorsSetup } from '@beyond-js/packages/sdk';
import type { IProcessedSpec } from '@beyond-js/packages/module';
import { ESMConditional } from '@beyond-js/packages/sdk';

export /*bundle*/ class ESM extends ESMConditional {
	_spec(values: Record<string, any>): IProcessedSpec {
		return { values };
	}

	/**
	 * All the properties that are not reserved for the module specification
	 * are considered the spec of the 'ts' processor
	 */
	_processors(): IProcessorsSetup {
		const reserved = ['platforms'];
		const spec: Record<string, any> = {};
		for (const [key, value] of Object.entries(this.spec.values)) {
			if (reserved.includes(key)) continue;
			spec[key] = value;
		}

		const specifier = '@beyond-js/packages/bundlers/ts/processors/ts';
		const processors = new Map([['ts', { specifier, ...spec }]]);
		return { processors };
	}
}
