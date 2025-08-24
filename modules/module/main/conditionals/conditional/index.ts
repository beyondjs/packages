import type { BaseModule } from '../../';
import type { ModuleSpecType } from '@beyond-js/packages/module/spec';
import { ConditionalSpec } from './spec';

export /*bundle*/ interface IProcessedSpec {
	values: object | string;
	errors?: Array<any>;
	warnings?: Array<any>;
}

export /*bundle*/ interface IOutput {
	code: string;
	map?: string;
}
export /*bundle*/ type OutputsType = Map<string, IOutput> & { destroy: () => void };

export /*bundle*/ abstract class BaseConditional {
	#module: BaseModule;
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

	#spec: ConditionalSpec;
	get spec(): ConditionalSpec {
		return this.#spec;
	}

	abstract get outputs(): OutputsType;

	/**
	 * This method can be overriden to process the spec values required for the processing of the outputs
	 *
	 * @param {object} values
	 * @returns {values: object | string, errors?: Array<any>, warnings?: Array<any>}
	 */
	_spec(values: ModuleSpecType): IProcessedSpec {
		// The module should return only the spec values it will require for the processing of the outputs.
		// Take into account that a change in the spec values will invalidate the outputs.
		void values;
		return { values: {} };
	}

	constructor(module: BaseModule, conditions: { platform: string; environment?: string }) {
		this.#module = module;
		this.#spec = new ConditionalSpec(this);

		const { platform, environment } = conditions;
		this.#platform = platform;
		this.#environment = environment;
	}

	destroy() {
		this.#spec.destroy();
		this.outputs.destroy();
	}
}
