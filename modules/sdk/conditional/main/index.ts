import type { IConditionalStrategy } from './types';
import type { BaseModule, IProcessors } from '../../module';
import type { IConditions } from '@beyond-js/packages/types';
import { BaseConditional } from '@beyond-js/packages/module';
import { Processors } from '../processors/base';
import { ConditionalsStore } from './store';

export /*bundler*/ abstract class Conditional extends BaseConditional {
	get module(): BaseModule {
		return <BaseModule>super.module;
	}

	#processors: Processors;
	get processors(): Processors {
		return this.#processors;
	}

	#store: ConditionalsStore;
	get store(): ConditionalsStore {
		return this.#store;
	}

	/**
	 * The processors are of the conditional, but they can be the same for all conditionals of the module.
	 * If the specifier is not provided, it will be resolved by the _resolve method of the processors collection.
	 */
	_processors(): IProcessors {
		return this.module._processors();
	}

	constructor(module: BaseModule, conditions: IConditions, strategy: IConditionalStrategy) {
		if (typeof strategy !== 'object') {
			throw new Error(`Invalid strategy. An object is expected`);
		}
		if (typeof strategy.outputs !== 'object') {
			throw new Error(`Invalid strategy. Property 'outputs' was expected as an object`);
		}

		super(module, conditions);

		this.#processors = strategy.Processors ? new strategy.Processors(this) : new Processors(this);
		this.#store = new ConditionalsStore(this);
	}
}
