import type { BaseModule } from '../';
import type { BaseConditional } from './conditional';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

interface IDone {
	updated: Map<string, BaseConditional>;
}

export class Conditionals extends DynamicProcessor(Map<string, BaseConditional>) {
	get dp() {
		return 'module.conditionals';
	}

	#module: BaseModule;

	constructor(module: BaseModule) {
		super();
		this.#module = module;

		super.setup(new Map([['module-specs', { child: module.spec }]]));
	}

	_process() {
		const conditionals = this.#module._conditionals();
		if (!(conditionals instanceof Array)) {
			throw new Error(`Module conditionals must be an array.`);
		}

		const done = ({ updated }: IDone): void | boolean => {
			const changed = this.size !== updated.size || Array.from(this.keys()).some(key => !updated.has(key));
			if (!changed) return false;

			// Destroy unused conditionals
			this.forEach((conditional, key) => !updated.has(key) && conditional.destroy());

			super.clear();
			updated.forEach((conditional, key) => this.set(key, conditional));
		};

		const updated: Map<string, BaseConditional> = new Map();
		conditionals.forEach(conditions => {
			if (typeof conditions.platform !== 'string') {
				throw new Error(`Module platform condition must be a string.`);
			}
			if (conditions.environment && typeof conditions.environment !== 'string') {
				throw new Error(`Module environment condition must be a string.`);
			}

			const { platform } = conditions;
			const environment = conditions.environment ? `/${conditions.environment}` : '';
			const key = `${platform}${environment}`;
			const conditional = this.has(key) ? this.get(key) : this.#module._conditional({ key, conditions });
			updated.set(key, conditional);
		});

		return done({ updated });
	}

	#clear = () => {
		this.forEach(conditional => conditional.destroy());
	};

	destroy() {
		super.destroy();
		this.#clear();
	}
}
