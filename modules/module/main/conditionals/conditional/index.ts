import type { BaseModule } from '../../';
import type { ModuleSpecType } from '@beyond-js/packages/module/spec';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import { ConditionalSpec } from './spec';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export /*bundle*/ interface IProcessedSpec {
	values: object | string;
	errors?: Array<any>;
	warnings?: Array<any>;
}

export /*bundle*/ abstract class BaseConditional extends DynamicProcessor() {
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

	abstract get output(): ConditionalOutput;

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
		super();
		this.#module = module;

		const { platform, environment } = conditions;
		this.#platform = platform;
		this.#environment = environment;

		this.#spec = new ConditionalSpec(this);
		super.setup(new Map([['spec', { child: this.#spec }]]));
	}

	destroy() {
		this.#spec.destroy();
	}
}
