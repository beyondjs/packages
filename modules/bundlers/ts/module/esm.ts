import type { IProcessorsSetup } from '@beyond-js/packages/sdk';
import type { IProcessedSpec } from '@beyond-js/packages/module';
import { ESMConditional } from '@beyond-js/packages/sdk';
import { Spec } from './spec';

/**
 * The processors of the TypeScript bundler, by name and public module. `ts` transforms the TypeScript and
 * TSX sources; `styles` compiles the CSS and SCSS sources, with Tailwind where a stylesheet imports it;
 * `vue` and `svelte` compile the single-file components of those frameworks into internal modules and
 * stylesheets. A processor whose inputs are absent from a module produces nothing and loads no compiler.
 */
const PROCESSORS = {
	ts: '@beyond-js/packages/bundlers/ts/processors/ts',
	styles: '@beyond-js/packages/bundlers/ts/processors/styles',
	vue: '@beyond-js/packages/bundlers/ts/processors/vue',
	svelte: '@beyond-js/packages/bundlers/ts/processors/svelte'
};

/**
 * The executable conditional of a module compiled by the TypeScript bundler, for one platform
 */
export /*bundle*/ class ESM extends ESMConditional {
	_spec(values: Record<string, any>): IProcessedSpec {
		return Spec.values(values, this.platform, this.environment);
	}

	/**
	 * Every processor receives the values of the conditional that are not reserved for the module, and
	 * the style processor also receives the tailwind inputs the manifest declares
	 */
	_processors(): IProcessorsSetup {
		const values = <Record<string, any>>this.spec.values;
		const processors = new Map(
			Object.entries(PROCESSORS).map(([name, specifier]) => {
				const extra = name === 'styles' && values?.tailwind !== void 0 ? { tailwind: values.tailwind } : {};
				return [name, Spec.processor(values, specifier, extra)];
			})
		);
		return { processors };
	}
}
