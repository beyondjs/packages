import type { IProcessorSpec } from '@beyond-js/packages/sdk/module';
import { BaseModule } from '@beyond-js/packages/sdk';
import { Conditional } from '@beyond-js/packages/sdk';

export class Module extends BaseModule {
	_conditionals() {
		let { platforms } = this.spec.source.values;
		platforms = typeof platforms === 'string' ? [platforms] : platforms;
		platforms = platforms || ['default'];
		platforms = platforms?.filter(platform => platform && typeof platform === 'string');
		platforms = platforms instanceof Array ? platforms : ['default'];

		const conditions = platforms.map(platform => ({ platform }));
		return conditions;
	}

	_conditional({ platform }) {
		return new Conditional(this, { platform }, { processors: {}, outputs: { esm: {} } });
	}

	/**
	 * All the properties that are not reserved for the module specification
	 * are considered the spec of the 'ts' processor
	 */
	_processors() {
		const reserved = ['platforms'];
		const spec: IProcessorSpec = {};
		for (const [key, value] of Object.entries(this.spec.source.values)) {
			if (reserved.includes(key)) continue;
			spec[key] = value;
		}

		const processors = new Map([
			['ts', { specifier: '@beyond-js/ts-bundler/processors/ts', ...spec }],
			['tsc', { specifier: '@beyond-js/ts-bundler/processors/tsc', ...spec }]
		]);
		return { processors };
	}
}
