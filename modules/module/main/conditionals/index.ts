import type { Module } from '../';
import type { Conditional } from './conditional';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export class Conditionals extends DynamicProcessor(Map<string, Conditional>) {
	get dp() {
		return 'module.conditionals';
	}

	#module: Module;

	constructor(module: Module) {
		super();
		this.#module = module;
		super.setup(new Map([['module-specs', { child: module.spec }]]));
	}

	_process() {
		const conditionals = this.#module._conditionals();
		if (!(conditionals instanceof Array)) {
			throw new Error(`Module conditionals must be an array.`);
		}

		const updated = new Map();
		conditionals.forEach(conditions => {
			const { platform } = conditions;
			if (typeof platform !== 'string') {
				throw new Error(`Module conditionals platform must be a string.`);
			}

			const environment = conditions.environment ? `:${conditions.environment}` : '';
			const key = `${platform}:${environment}`;
			const conditional = this.has(key) ? this.get(key) : this.#module._conditional({ key });
			updated.set(key, conditional);
		});

		// Destroy unused conditionals
		this.forEach((conditional, key) => !updated.has(key) && conditional.destroy());

		this.#clear();
		updated.forEach((conditional, key) => this.set(key, conditional));
	}

	#clear = () => {
		this.forEach(conditional => conditional.destroy());
	};

	destroy() {
		super.destroy();
		this.#clear();
	}
}
