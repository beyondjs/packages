import type { Conditional } from '../main';
import type { IProcessorStrategy } from './types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { ProcessorSources } from './sources';
import { ProcessorExtender } from './extender';
import { ProcessorSettings } from './settings';
import { ProcessorSpec } from './spec';
import { ProcessorOutputs } from './outputs';
import { join } from 'path';

export class Processor {
	#conditional: Conditional;
	get conditional(): Conditional {
		return this.#conditional;
	}

	#name: string;
	get name(): string {
		return this.#name;
	}

	/**
	 * The settings object for the processor as specified in the package.json file
	 */
	#settings;
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
		const path = this.#conditional.module.path.dirname;
		const spec = this.#spec.values;
		return join(path, spec.path || '');
	}

	#sources;
	get sources() {
		return this.#sources;
	}

	#extender;
	get extender() {
		return this.#extender;
	}

	#outputs;
	get outputs() {
		return this.#outputs;
	}

	/**
	 * The bundler processor constructor
	 * @param {object} conditional - The module conditional
	 * @param {string} name - The name of the processor
	 * @param {object} strategy
	 */
	constructor(conditional: Conditional, name: string, strategy: IProcessorStrategy) {
		this.#conditional = conditional;
		this.#name = name;

		if (!strategy) {
			throw new Error(`Processor "${name}" error: "strategy" specification is required`);
		}

		const Settings = strategy.Settings || ProcessorSettings;
		this.#settings = new Settings(this);

		const Spec = strategy.Spec || ProcessorSpec;
		this.#spec = new Spec(this);

		const Sources = strategy.sources && (strategy.sources.Sources || ProcessorSources);
		this.#sources = Sources && new Sources(this, strategy.sources);

		const Extender = strategy.extender && (strategy.extender?.Extender || ProcessorExtender);
		this.#extender = Extender && new Extender(this, strategy.extender);

		this.#outputs = strategy.outputs && new ProcessorOutputs(this, strategy.outputs);
	}

	/**
	 * This method can be overriden to provide the spec values required for its processing
	 * The processor should return only the spec (as set in the module.json) it will require for its processing
	 * Take into account that a change in the spec values will invalidate the processor
	 * @param {*} values
	 * @returns
	 */
	_spec(values: any): { values: object; errors?: IDiagnostic[]; warnings?: IDiagnostic[] } {
		const output = {};
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
	 * @param {*} values
	 * @returns
	 */
	_settings(values: object): { values: object; errors?: IDiagnostic[]; warnings?: IDiagnostic[] } {
		void values;
		return { values: {} };
	}
}
