import type { BaseConditional } from './';
import type { Output } from './output';

export /*bundle*/ type OutputsStrategyType = Map<string, { Output: typeof Output }>;

export class Outputs extends Map<string, Output> {
	#conditional: BaseConditional;
	get conditional(): BaseConditional {
		return this.#conditional;
	}

	constructor(conditional: BaseConditional, strategy: OutputsStrategyType) {
		super();
		this.#conditional = conditional;

		if (!(strategy instanceof Map) || !strategy.size) {
			throw new Error(`Invalid outputs specification for conditional. At least one output is expected`);
		}

		strategy.forEach((strategy, key) => {
			if (typeof strategy !== 'object') {
				throw new Error(`Invalid output "${key}" on conditional. An object is expected`);
			}
			const { Output } = strategy;
			if (typeof Output !== 'function') {
				throw new Error(`Invalid output "${key}" on conditional. A class is expected`);
			}

			this.set(key, new Output(conditional, strategy));
		});
	}

	clear() {
		this.forEach(output => output.destroy());
		super.clear();
	}

	destroy() {
		this.clear();
	}
}
