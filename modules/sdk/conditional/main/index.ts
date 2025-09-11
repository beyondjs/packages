import type { IConditionalStrategy } from './types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BaseModule } from '../../module';
import type { IConditions } from '@beyond-js/packages/types';
import { BaseConditional } from '@beyond-js/packages/module';
import { Processors } from '../processors/base';
import { db } from '@beyond-js/packages/persistence/db';

export /*bundle*/ interface IProcessorSpec {
	specifier: string;
	[key: string]: any;
}

export /*bundle*/ interface IProcessorsSetup {
	processors: Map<string, IProcessorSpec>;
	errors: IDiagnostic[];
	warnings: IDiagnostic[];
}

export /*bundler*/ abstract class Conditional extends BaseConditional {
	get module(): BaseModule {
		return <BaseModule>super.module;
	}

	#processors: Processors;
	get processors(): Processors {
		return this.#processors;
	}

	/**
	 * The processors are of the conditional, but they can be the same for all conditionals of the module.
	 * If the specifier is not provided, it will be resolved by the _resolve method of the processors collection.
	 */
	_processors(): IProcessorsSetup {
		return this.module._processors();
	}

	constructor(module: BaseModule, conditions: IConditions, strategy: IConditionalStrategy) {
		if (typeof strategy !== 'object') {
			throw new Error(`Invalid strategy. An object is expected`);
		}

		super(module, conditions);
		this.#processors = strategy.Processors ? new strategy.Processors(this) : new Processors(this);
	}
}
