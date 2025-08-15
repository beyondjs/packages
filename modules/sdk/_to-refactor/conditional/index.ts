import { Outputs } from './outputs';
import { ConditionalSpec } from '';
import { ipc } from '@beyond-js/ipc/main';

export class Conditional {
	#module;
	get module() {
		return this.#module;
	}

	#platform;
	get platform() {
		return this.#platform;
	}

	#environment;
	get environment() {
		return this.#environment;
	}

	#specs;
	get specs() {
		return this.#specs;
	}

	#id;
	get id() {
		return this.#id;
	}

	#outputs;
	get outputs() {
		return this.#outputs;
	}

	/**
	 * This method can be overriden to process the specs values required for the processing of the outputs
	 *
	 * @param {object} values
	 * @returns
	 */
	_specs(values) {
		// The module should return only the specs values it will require for the processing of the outputs
		// Take into account that a change in the specs values will invalidate the outputs
		void values;
		return { values: {} };
	}

	_outputs() {
		throw new Error(`Private method '_outputs' must be overriden`);
	}

	_output(key) {
		void key;
		throw new Error(`Private method '_output' must be overriden`);
	}

	/**
	 * Technically the processors are of the conditional,
	 * but they can be the same for all conditionals of the module.
	 * If the specifier is not provided, it will be resolved by the _resolve method of the processors collection.
	 *
	 * @returns {Map<string, {specs: object, specifier?: string}>} - The processors of the conditional
	 */
	_processors() {
		return this.#module._processors();
	}

	constructor(module, conditions) {
		this.#module = module;
		this.#specs = new Specs(this);

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
	_initialize(strategy) {
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
		super.destroy();
	}
}
