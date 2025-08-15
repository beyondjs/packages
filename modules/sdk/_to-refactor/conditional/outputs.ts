import { Conditional } from './';

export class Outputs extends Map {
	#conditional: Conditional;
	get conditional() {
		return this.#conditional;
	}

	constructor(conditional, strategy) {
		super();
		this.#conditional = conditional;

		if (!(strategy instanceof Map) || !strategy.size) {
			throw new Error(
				`Invalid outputs specification for conditional "${conditional.module.specifier}". At least one output is expected`
			);
		}

		strategy.forEach((strategy, key) => {
			if (typeof strategy !== 'object') {
				throw new Error(
					`Invalid output "${key}" on conditional "${conditional.module.specifier}". An object is expected`
				);
			}
			const { Output } = strategy;
			if (typeof Output !== 'function') {
				throw new Error(
					`Invalid output "${key}" on conditional "${conditional.module.specifier}". A class is expected`
				);
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
