import type { BaseModule } from '../../';
import type { ModuleSpecType } from '@beyond-js/packages/module/spec';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import { ConditionalSpec } from './spec';
import type { IRequest, IProcessResponse } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export /*bundle*/ interface IProcessedSpec {
	values: object | string;
	errors?: Array<any>;
	warnings?: Array<any>;
}

export /*bundle*/ abstract class BaseConditional extends DynamicProcessor() {
	get dp() {
		return 'module.conditional';
	}

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

	#errors: IDiagnostic[] = [];

	/**
	 * The diagnostics of the conditional itself: `PROCESSING_FAILED` when its last processing threw
	 */
	get errors() {
		return this.#errors;
	}
	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}
	get valid() {
		return !this.#errors?.length;
	}

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

	constructor(module: BaseModule, conditions: IConditions) {
		super();
		this.#module = module;

		const { platform, environment } = conditions;
		this.#platform = platform;
		this.#environment = environment;

		// The dynamic processor settles the readiness of a conditional only when a processing returns: one that
		// throws or rejects would leave it, and every request waiting for it, pending forever. Whatever a concrete
		// conditional processes, a throw becomes a diagnostic of the conditional and the processing ends.
		const process = this._process;
		this._process = (request: IRequest) => this.#guarded(() => process.call(this, request));

		this.#spec = new ConditionalSpec(this);
		super.setup(new Map([['spec', { child: this.#spec }]]));
	}

	#guarded(process: () => IProcessResponse | Promise<IProcessResponse>): IProcessResponse | Promise<IProcessResponse> {
		// A processing that follows a failed one reports a change, so consumers read the conditional again
		const recovered = !!this.#errors.length;
		this.#errors = [];
		const answer = (response: IProcessResponse): IProcessResponse => (recovered && (response === void 0 || typeof response === 'boolean') ? true : response);
		const failed = (exc: unknown): IProcessResponse => {
			const message = `The processing of the "${this.#platform}${this.#environment ? `/${this.#environment}` : ''}" conditional failed: ${exc instanceof Error ? exc.message : exc}`;
			this.#errors = [{ code: 'PROCESSING_FAILED', message }];
			return true;
		};
		try {
			const response = process();
			return response instanceof Promise ? response.then(answer, failed) : answer(response);
		} catch (exc) {
			return failed(exc);
		}
	}

	destroy() {
		super.destroy();
		this.#spec.destroy();
	}
}
