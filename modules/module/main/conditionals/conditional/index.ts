import type { Module } from '../../';
import type { Output, OutputStrategyType } from './output';
import type { ModuleSpecType } from '@beyond-js/packages/module/spec';
import { Outputs } from './outputs';
import { ConditionalSpec } from './spec';

export /*bundle*/ interface IStrategy {
	outputs: Map<string, OutputStrategyType>;
}

export class Conditional {
	#module: Module;
	get module() {
		return this.#module;
	}

	#platform: string;
	get platform() {
		return this.#platform;
	}

	#environment: string | undefined;
	get environment() {
		return this.#environment;
	}

	#spec;
	get spec() {
		return this.#spec;
	}

	#id;
	get id() {
		return this.#id;
	}

	#outputs: Outputs;
	get outputs(): Outputs {
		return this.#outputs;
	}

	/**
	 * This method can be overriden to process the spec values required for the processing of the outputs
	 *
	 * @param {object} values
	 * @returns
	 */
	_spec(values: ModuleSpecType): { values: Record<string, any> } {
		// The module should return only the spec values it will require for the processing of the outputs.
		// Take into account that a change in the spec values will invalidate the outputs.
		void values;
		return { values: {} };
	}

	_outputs() {
		throw new Error(`Private method '_outputs' must be overriden`);
	}

	_output(key: string): Output {
		void key;
		throw new Error(`Private method '_output' must be overriden`);
	}

	/**
	 * Technically the processors are of the conditional,
	 * but they can be the same for all conditionals of the module.
	 * If the specifier is not provided, it will be resolved by the _resolve method of the processors collection.
	 *
	 * @returns {Map<string, {spec: object, specifier?: string}>} - The processors of the conditional
	 */
	_processors() {
		return this.#module._processors();
	}

	constructor(module: Module, conditions: { platform: string; environment?: string }) {
		this.#module = module;
		this.#spec = new ConditionalSpec(this);

		const { platform, environment } = conditions;
		this.#id = `${this.#module.id}//${platform}` + environment ? `:${environment}` : '';
		this.#platform = platform;
		this.#environment = environment;
	}

	/**
	 * This method exists to delay the initialization of outputs until after the subclass has finished
	 * setting up its own required properties.
	 *
	 * Inheriting classes may define properties (e.g., processors) that are needed by the Outputs instance.
	 * Since the parent constructor runs before the subclass constructor, those properties would not be available yet.
	 *
	 * By using _initialize(), the subclass can first initialize its required state, then call this method
	 * to safely initialize Outputs with everything in place.
	 */
	_initialize(strategy: IStrategy) {
		if (typeof strategy !== 'object') {
			throw new Error('The strategy must be an object');
		}
		if (!strategy.outputs) {
			throw new Error('The strategy must have an outputs property');
		}

		this.#outputs = strategy?.outputs && new Outputs(this, strategy.outputs);
	}

	destroy() {
		this.#outputs.destroy();
	}
}
