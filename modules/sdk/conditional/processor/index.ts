import type { Conditional } from '../main';
import type { IProcessorStrategy } from './types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { DynamicProcessorImplementation, IRequest } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ProcessorSources } from './sources';
import { ProcessorSettings } from './settings';
import { ProcessorSpec } from './spec';
import { ProcessorOutputs } from './outputs';
import { join } from 'path';

export /*bundle*/ abstract class ConditionalProcessor extends DynamicProcessor() {
	#conditional: Conditional;
	get conditional(): Conditional {
		return this.#conditional;
	}

	#name: string;
	get name(): string {
		return this.#name;
	}

	#delegates: Set<string>;
	get delegates(): Set<string> {
		return this.#delegates;
	}

	/**
	 * The settings object for the processor as specified in the package.json file
	 */
	#settings: ProcessorSettings;
	get settings() {
		return this.#settings;
	}

	/**
	 * The spec object for the processor as specified in the modiule.json file
	 */
	#spec: ProcessorSpec;
	get spec(): ProcessorSpec {
		return this.#spec;
	}

	get path(): string {
		const { path } = this.#conditional.module.spec;
		const spec = this.#spec.values;
		return join(path, spec.path || '');
	}

	#sources: ProcessorSources;
	get sources() {
		return this.#sources;
	}

	#outputs: ProcessorOutputs;
	get outputs() {
		return this.#outputs;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid(): boolean {
		return !this.errors.length;
	}

	/**
	 * The bundler processor constructor
	 *
	 * @param conditional The module conditional
	 * @param name The name of the processor
	 * @param strategy The processor strategy
	 */
	constructor(conditional: Conditional, name: string, strategy: IProcessorStrategy) {
		if (!strategy) {
			throw new Error(`Processor "${name}" error: "strategy" specification is required`);
		}
		if (strategy.delegates && !Array.isArray(strategy.delegates)) {
			throw new Error(`Processor "${name}" error: "strategy.delegates" must be an array of strings`);
		}

		super();
		this.#conditional = conditional;
		this.#name = name;
		this.#delegates = new Set(strategy.delegates);

		const children: Map<string, { child: DynamicProcessorImplementation }> = new Map();

		const Settings = strategy.Settings || ProcessorSettings;
		this.#settings = new Settings(this);
		children.set('settings', { child: this.#settings });

		const Spec = strategy.Spec || ProcessorSpec;
		this.#spec = new Spec(this);
		children.set('spec', { child: this.#spec });

		const Sources = strategy.sources && (strategy.sources.Sources || ProcessorSources);
		this.#sources = Sources && new Sources(this, strategy.sources);
		children.set('sources', { child: this.#sources });

		super.setup(children);
	}

	/**
	 * This method can be overriden to provide the spec values required for its processing
	 * The processor should return only the spec (as set in the module.json) it will require for its processing
	 * Take into account that a change in the spec values will invalidate the processor
	 *
	 * @param values
	 * @returns
	 */
	_spec(values: any): { values: any; errors?: IDiagnostic[]; warnings?: IDiagnostic[] } {
		const output: any = {};
		if (this.#sources.inputs) {
			values.path && (output.path = values.path);
			values.files && (output.files = values.files);
		}

		return { values: output };
	}

	/**
	 * This method can be overriden to provide the settings (as set in the package.json) required for its processing
	 * The processor should return only the settings it will require for its processing
	 * Take into consideration that a change in the settings will invalidate the processor
	 *
	 * @param values
	 * @returns
	 */
	_settings(values: object): { values: object; errors?: IDiagnostic[]; warnings?: IDiagnostic[] } {
		void values;
		return { values: {} };
	}

	abstract _build(request: IRequest, outputs: ProcessorOutputs): Promise<void>;

	async _process(request: IRequest) {
		const outputs = new ProcessorOutputs({ delegates: this.#delegates });
		await this._build(request, outputs);
		if (request !== this._request) return;

		this.#outputs = outputs;
	}

	destroy() {
		this.#sources?.destroy();
	}
}
