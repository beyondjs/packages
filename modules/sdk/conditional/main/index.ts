import type { Module } from '../../module';
import type { IConditions } from '@beyond-js/packages/types';
import { Conditional } from '@beyond-js/packages/module';
import { Processors } from '@beyond-js/bundlers-sdk/bundler/processors';
import { BundlerStore } from './store';
import { ESMOutput } from './outputs/esm';
import { LocalOutput } from './outputs/local';
import { TypesOutput } from './outputs/types';
import { CSSOutput } from './outputs/css';

export /*bundler*/ class Bundler extends Conditional {
	get module(): Module {
		return super.module;
	}

	#processors: Processors;
	get processors(): Processors {
		return this.#processors;
	}

	#store: BundlerStore;
	get store(): BundlerStore {
		return this.#store;
	}

	/**
	 * Technically the processors are of the conditional,
	 * but they can be the same for all conditionals of the module.
	 * If the specifier is not provided, it will be resolved by the _resolve method of the processors collection.
	 *
	 * @returns {Map<string, {spec: object, specifier?: string}>} - The processors of the conditional
	 */
	_processors() {
		return this.module._processors();
	}

	constructor(module: Module, conditions: IConditions, strategy) {
		if (typeof strategy !== 'object') {
			throw new Error(`Invalid strategy. An object is expected`);
		}
		if (!strategy.Processors && !strategy.processors) {
			throw new Error(`Invalid strategy. A Processors class is expected`);
		}
		if (typeof strategy.outputs !== 'object') {
			throw new Error(`Invalid strategy. An outputs object is expected`);
		}

		const { esm, local, types, css } = strategy.outputs;
		const outputs = new Map();
		esm && outputs.set('esm', Object.assign(esm, { Output: ESMOutput }));
		local && outputs.set('local', Object.assign(local, { Output: LocalOutput }));
		types && outputs.set('types', Object.assign(types, { Output: TypesOutput }));
		css && outputs.set('css', Object.assign(css, { Output: CSSOutput }));
		if (!outputs.size) {
			throw new Error(`Invalid outputs specification. At least one output was expected`);
		}

		super(module, conditions);

		this.#processors = strategy.processors
			? new Processors(this, strategy.processors)
			: new strategy.Processors(this);

		this.#store = new BundlerStore(this);

		super._initialize({ outputs });
	}
}
