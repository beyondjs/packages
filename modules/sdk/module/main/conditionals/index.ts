import type { Module } from '../';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Propagator } from './propagator';

export class Conditionals extends DynamicProcessor(Map<string, Conditional>) {
	get dp() {
		return 'module.conditionals';
	}

	#module: Module;
	#propagator: Propagator;

	constructor(module: Module) {
		super();
		this.#module = module;
		this.#propagator = new Propagator(this);

		super.setup(new Map([['module-specs', { child: module.spec }]]));
	}

	_process() {
		const conditionals = this.#module._conditionals();
		if (!(conditionals instanceof Array)) {
			throw new Error(`Module conditionals must be an array. ${this.#module.vname}`);
		}

		const updated = new Map();
		conditionals.forEach(conditions => {
			const { platform } = conditions;
			if (typeof platform !== 'string') {
				throw new Error(`Module conditionals platform must be a string. ${this.#module.vname}`);
			}

			const conditional = this.has(platform) ? this.get(platform) : this.#module._conditional({ platform });
			updated.set(platform, conditional);
		});

		// Destroy unused conditionals
		this.forEach((conditional, key) => !updated.has(key) && conditional.destroy());

		// @TODO: Propagator subscribe and unsubscribe

		this.#clear();
		updated.forEach((conditional, key) => this.set(key, conditional));
	}

	#clear = () => {
		this.forEach(conditional => {
			this.#propagator.unsubscribe(conditional);
			conditional.destroy();
		});
	};

	destroy() {
		super.destroy();
		this.#clear();
	}
}
